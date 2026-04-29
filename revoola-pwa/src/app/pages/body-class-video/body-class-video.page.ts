import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  NgZone,
  HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { VideoModel } from '../../models/video.model';
import { PosthogService } from '../../services/posthog.service';

/**
 * Mirrors BodyClassVideoFragment exactly.
 *
 * Features replicated:
 * - Landscape fullscreen (Screen Orientation API)
 * - 5-second countdown overlay with scale animation (CountDownTimer)
 * - HTML5 <video> replaces Android VideoView
 * - Play/Pause/Stop controls (center overlay, toggle tap)
 * - Timer: remaining time, updates every second (Handler.postDelayed)
 * - Swipe left/right on left panel toggles timer visibility (GestureDetector)
 * - Stop → upgrade dialog → navigate home (showFullAppUpgradeDialog)
 * - Back button also triggers stop process
 */
@Component({
  selector: 'app-body-class-video',
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
  templateUrl: './body-class-video.page.html',
  styleUrls: ['./body-class-video.page.scss'],
})
export class BodyClassVideoPage implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('videoEl') videoElRef!: ElementRef<HTMLVideoElement>;

  // ── State ────────────────────────────────────────────────────────────────
  videoData: VideoModel | null = null;
  videoId = '';
  videoSrc = '';
  autoplayMuted = true;

  // Countdown (mirrors RLstartCountdown)
  countdownVisible = true;
  countdownValue = 5;

  // Controls overlay visibility (mirrors pauseStopVideoView)
  controlsVisible = false;

  /** Shown when autoplay failed or media error — invite user to tap. */
  showTapToPlayHint = false;

  // Pause state (mirrors pauseVideo)
  isPaused = false;

  // Timer display (mirrors txt_number)
  remainingTime = '00:00';

  // Sensor/timer panel on left (mirrors relaySensorProgress visibility)
  timerPanelVisible = true;

  // Upgrade dialog
  showUpgradeDialog = false;
  /** Trigger source — kept for analytics. Dialog content does NOT branch on this. */
  dialogVariant: 'completion' | 'exit' = 'exit';
  /** 1 = celebration sheet over save-screen background; 2 = results-page reveal. */
  dialogStage: 1 | 2 = 1;
  forceLandscapeVisualFallback = false;

  // Difficulty
  difficultyClass = '';
  difficultyIconPath = '';
  isMindVideo = false;

  // ── Private ──────────────────────────────────────────────────────────────
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private orientationEnforcer: ReturnType<typeof setInterval> | null = null;
  private resumeListenerHandle: { remove: () => Promise<void> } | null = null;
  private isOrientationLockActive = false;
  private isVideoReadyToStart = false;
  private playbackInitialized = false;
  private playStartInFlight = false;
  /** One automatic load+play retry after a media `error` event. */
  private mediaErrorAutoRetried = false;

  // Swipe gesture tracking (mirrors SwipeGestureListener)
  private touchStartX = 0;
  private touchStartY = 0;
  private readonly SWIPE_THRESHOLD = 50;

  // Play Store package (mirrors FULL_APP_PACKAGE)
  private readonly FULL_APP_PACKAGE = 'com.revoola';

  constructor(
    private router: Router,
    private zone: NgZone,
    private posthog: PosthogService
  ) {}

  ngOnInit(): void {
    const hasState = this.readNavState();
    if (!hasState) {
      // This page now requires state from body-class-view.
      this.router.navigate(['/body-class-view'], { replaceUrl: true });
    }
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.stopLandscapeEnforcer();
  }

  async ionViewWillEnter(): Promise<void> {
    const hasState = this.readNavState();
    if (!hasState) {
      this.router.navigate(['/body-class-view'], { replaceUrl: true });
      return;
    }
    this.resetPlaybackSession();
    this.isOrientationLockActive = true;
    this.updateVisualLandscapeFallback();
    this.startLandscapeEnforcer();
    await this.forceLandscapeLock();
  }

  async ionViewDidEnter(): Promise<void> {
    this.startCountdown();
    this.updateVisualLandscapeFallback();
    await this.forceLandscapeLock();
  }

  async ionViewWillLeave(): Promise<void> {
    this.isOrientationLockActive = false;
    this.forceLandscapeVisualFallback = false;
    this.stopLandscapeEnforcer();
    await this.unlockOrientation();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateVisualLandscapeFallback();
  }

  @HostListener('window:orientationchange')
  onOrientationChange(): void {
    this.updateVisualLandscapeFallback();
  }

  // ── Navigation state ─────────────────────────────────────────────────────
  private readNavState(): boolean {
    const nav = this.router.getCurrentNavigation();
    const state = nav?.extras?.state ?? history.state;
    const passedVideoUrl = this.normalizeUrl(state?.['videoUrl'] ?? '');
    this.videoId = (state?.['videoId'] ?? '').trim();
    this.isMindVideo = Boolean(state?.['isMindVideo']);

    if (state?.['videoData']) {
      try {
        this.videoData = JSON.parse(state['videoData']) as VideoModel;
        if (!this.videoId) {
          this.videoId = String(((this.videoData as unknown as Record<string, unknown>)?.['id']) ?? '').trim();
        }
        this.videoSrc = passedVideoUrl || this.resolveVideoSrc(this.videoData);
        this.mediaErrorAutoRetried = false;
        this.setDifficulty(this.videoData?.difficulty ?? '');
        return !!this.videoSrc;
      } catch (e) {
        console.error('[BodyClassVideo] State parse error:', e);
      }
    }

    if (passedVideoUrl) {
      this.videoSrc = passedVideoUrl;
      this.mediaErrorAutoRetried = false;
      return true;
    }

    return false;
  }

  // ── After view — start video + countdown ─────────────────────────────────
  ngAfterViewInit(): void {
    // Ensure orientation lock is re-applied once DOM/video area is mounted.
    void this.forceLandscapeLock();
  }

  /**
   * Ionic keeps route components alive in the outlet stack.
   * Reinitialize transient playback state on every re-entry.
   */
  private resetPlaybackSession(): void {
    this.clearTimers();
    this.countdownVisible = true;
    this.countdownValue = 5;
    this.controlsVisible = false;
    this.showTapToPlayHint = false;
    this.isPaused = false;
    this.autoplayMuted = true;
    this.remainingTime = '00:00';
    this.isVideoReadyToStart = false;
    this.playbackInitialized = false;
    this.playStartInFlight = false;
    this.mediaErrorAutoRetried = false;

    const video = this.videoElRef?.nativeElement;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    video.muted = true;
    video.load();
  }

  // ── Countdown — mirrors RLstartCountdown (6000ms, 1s intervals) ──────────
  private startCountdown(): void {
    this.countdownValue = 5;
    this.countdownVisible = true;

    this.countdownTimer = setInterval(() => {
      this.zone.run(() => {
        this.countdownValue--;
        if (this.countdownValue <= 0) {
          clearInterval(this.countdownTimer!);
          this.countdownTimer = null;
          this.countdownVisible = false;
          void this.startPlaybackIfReady('autoplay');
        }
      });
    }, 1000);
  }

  // ── Video events ──────────────────────────────────────────────────────────

  /** Mirrors: setOnPreparedListener { mediaPlayer.start(); startTimer() } */
  onVideoCanPlay(): void {
    if (this.playbackInitialized) return;
    this.isVideoReadyToStart = true;
    void this.startPlaybackIfReady('autoplay');
  }

  private playbackProps(trigger: 'autoplay' | 'gesture') {
    return {
      trigger,
      muted: this.autoplayMuted,
      video_id: this.videoId || null,
      surface: this.isMindVideo ? 'mind' : 'body',
    };
  }

  private async startPlaybackIfReady(
    trigger: 'autoplay' | 'gesture' = 'autoplay'
  ): Promise<void> {
    const video = this.videoElRef?.nativeElement;
    if (!video || this.playbackInitialized) return;
    if (this.countdownVisible || !this.isVideoReadyToStart) return;
    if (this.playStartInFlight) return;

    this.playStartInFlight = true;
    void this.forceLandscapeLock();
    void this.posthog.capture('video_play_attempt', this.playbackProps(trigger));

    try {
      await video.play();
      this.playbackInitialized = true;
      this.mediaErrorAutoRetried = false;
      this.isPaused = false;
      this.showTapToPlayHint = false;
      this.controlsVisible = false;
      this.updateRemainingTime();
      this.startTimer();
      void this.posthog.capture('video_play_success', this.playbackProps(trigger));
    } catch (err) {
      this.isPaused = true;
      this.controlsVisible = true;
      this.showTapToPlayHint = true;
      void this.posthog.capture('video_play_failed', {
        ...this.playbackProps(trigger),
        error_name: (err as Error)?.name,
        error_message: (err as Error)?.message,
      });
    } finally {
      this.playStartInFlight = false;
    }
  }

  /** Mirrors: updateSeekBarRunnable — only ticks while actually playing. */
  private startTimer(): void {
    this.stopPlaybackTimer();
    this.timerInterval = setInterval(() => {
      this.zone.run(() => this.updateRemainingTime());
    }, 1000);
  }

  private stopPlaybackTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private updateRemainingTime(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video) return;
    if (video.paused || video.ended) return;
    const remaining = (video.duration - video.currentTime) * 1000;
    this.remainingTime = this.formatTime(remaining);
  }

  onVideoError(event: Event): void {
    const video = (event.target as HTMLVideoElement) || this.videoElRef?.nativeElement;
    if (!video) return;

    const code = video.error?.code ?? null;
    let srcHost: string | null = null;
    try {
      srcHost = new URL(video.currentSrc || video.src || this.videoSrc).hostname;
    } catch {
      srcHost = null;
    }

    void this.posthog.capture('video_element_error', {
      media_error_code: code,
      src_host: srcHost,
      video_id: this.videoId || null,
    });

    this.stopPlaybackTimer();

    if (!this.mediaErrorAutoRetried) {
      this.mediaErrorAutoRetried = true;
      this.playbackInitialized = false;
      video.load();
      void video
        .play()
        .then(() => {
          this.zone.run(() => {
            this.playbackInitialized = true;
            this.mediaErrorAutoRetried = false;
            this.isPaused = false;
            this.showTapToPlayHint = false;
            this.controlsVisible = false;
            this.updateRemainingTime();
            this.startTimer();
            void this.posthog.capture('video_play_success', this.playbackProps('autoplay'));
          });
        })
        .catch((err) => {
          this.zone.run(() => {
            this.isPaused = true;
            this.controlsVisible = true;
            this.showTapToPlayHint = true;
            void this.posthog.capture('video_play_failed', {
              ...this.playbackProps('autoplay'),
              error_name: (err as Error)?.name,
              error_message: (err as Error)?.message,
              after_media_error_retry: true,
            });
          });
        });
      return;
    }

    this.isPaused = true;
    this.controlsVisible = true;
    this.showTapToPlayHint = true;
  }

  onVideoStalled(): void {
    // Reserved for future buffering UX / telemetry.
  }

  onVideoWaiting(): void {
    // Reserved for future buffering UX / telemetry.
  }

  onVideoPlaying(): void {
    // Clears any stalled/waiting edge cases; timer only runs while playing.
  }

  /** Sync timer when element pauses (e.g. overlay pause) without duplicating togglePause work unnecessarily. */
  onVideoNativePause(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video || !this.playbackInitialized) return;
    if (video.paused && !video.ended) {
      this.stopPlaybackTimer();
      this.isPaused = true;
    }
  }

  /** Mirrors: RLformatTime(milliseconds) */
  private formatTime(ms: number): string {
    if (!ms || isNaN(ms) || ms < 0) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ── Controls overlay — mirrors relayVideoplay.setOnClickListener ─────────
  onSurfaceTap(): void {
    if (this.controlsVisible) {
      this.controlsVisible = false;
      return;
    }
    if (!this.playbackInitialized) {
      void this.startPlaybackIfReady('gesture');
      return;
    }
    // User gesture unlocks media on web autoplay-restricted browsers.
    this.tryPlayFromUserGesture();
    this.controlsVisible = true;
  }

  hideControls(event?: Event): void {
    event?.stopPropagation();
    this.controlsVisible = false;
  }

  // ── Pause / Resume — mirrors btnPauseResume.setOnClickListener ────────────
  togglePause(event?: Event): void {
    event?.stopPropagation();
    const video = this.videoElRef?.nativeElement;
    if (!video) return;

    if (!this.isPaused) {
      video.pause();
      this.stopPlaybackTimer();
      this.isPaused = true;
    } else {
      this.autoplayMuted = false;
      video.muted = false;
      void video
        .play()
        .then(() => {
          this.zone.run(() => {
            this.isPaused = false;
            this.updateRemainingTime();
            this.startTimer();
          });
        })
        .catch(() => {});
    }
  }

  // ── Stop — mirrors stopButtonProcess ─────────────────────────────────────
  stopVideo(event?: Event): void {
    event?.stopPropagation();
    const video = this.videoElRef?.nativeElement;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    this.clearTimers();
    this.dialogVariant = 'exit';
    this.dialogStage = 1;
    this.showUpgradeDialog = true;
    void this.posthog.capture('upgrade_dialog_shown', this.upgradeDialogProps());
  }

  /** Natural class completion — high-intent moment, show celebration stage of upgrade dialog. */
  onVideoEnded(): void {
    this.clearTimers();
    this.dialogVariant = 'completion';
    this.dialogStage = 1;
    this.showUpgradeDialog = true;
    void this.posthog.capture('upgrade_dialog_shown', this.upgradeDialogProps());
  }

  // ── Upgrade dialog actions ────────────────────────────────────────────────
  openPlayStore(): void {
    void this.posthog.capture('upgrade_dialog_cta_clicked', this.upgradeDialogProps());
    this.showUpgradeDialog = false;
    const url = `https://play.google.com/store/apps/details?id=${this.FULL_APP_PACKAGE}`;
    window.open(url, '_blank');
    this.navigateHome();
  }

  /** Stage 1 → Stage 2. Skip on celebration sheet advances to the results-reveal. */
  advanceDialogStage(): void {
    this.dialogStage = 2;
    void this.posthog.capture('upgrade_dialog_stage_advanced', this.upgradeDialogProps());
  }

  dismissDialog(): void {
    this.showUpgradeDialog = false;
    this.navigateHome();
  }

  private upgradeDialogProps() {
    return {
      variant: this.dialogVariant,
      stage: this.dialogStage,
      surface: this.isMindVideo ? 'mind' : 'body',
      video_id: this.videoId || null,
      duration_mins: this.classDurationMins,
    };
  }

  /** Rounded class length in minutes, or null if unknown. Used in the completion subline. */
  get classDurationMins(): number | null {
    const raw = Number(this.videoData?.duration);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }

  /**
   * Realistic-ceiling Effort Points for this class, rounded to the nearest 10.
   * Approximation: 1000 EP/hour at 100% effort × ~75% sustainable hard effort = ~12.5 per minute.
   * Used for the loss-framed subline on the body completion variant.
   * NOTE: dev should swap in the real formula if/when one is available.
   */
  get effortPointsApprox(): number | null {
    const mins = this.classDurationMins;
    if (mins == null) return null;
    return Math.round((mins * 12.5) / 10) * 10;
  }

  /** Primary CTA label — stage 1 always installs; stage 2 uses surface-specific copy. */
  get primaryCtaLabel(): string {
    if (this.dialogStage === 1) return 'Get the full app';
    return this.isMindVideo ? 'See my Relaxation Score' : 'Join the leaderboard';
  }

  /** Secondary CTA label — stage 1 advances; stage 2 dismisses. */
  get secondaryCtaLabel(): string {
    return this.dialogStage === 1 ? 'Skip' : 'Done for now';
  }

  /** Bound to (click) of the secondary button — branches on stage. */
  onSecondaryAction(): void {
    if (this.dialogStage === 1) {
      this.advanceDialogStage();
    } else {
      this.dismissDialog();
    }
  }

  private navigateHome(): void {
    this.router.navigate(['/body-class-view'], { replaceUrl: true });
  }

  // ── Back button (hardware / browser) — mirrors onBackPressedDispatcher ────
  @HostListener('window:popstate')
  onPopState(): void {
    if (!this.showUpgradeDialog) {
      this.stopVideo();
    }
  }

  // ── Touch / Swipe — mirrors SwipeGestureListener (left side panel) ────────
  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.touches[0].clientX;
    this.touchStartY = event.touches[0].clientY;
  }

  onTouchEnd(event: TouchEvent): void {
    const dx = event.changedTouches[0].clientX - this.touchStartX;
    const dy = event.changedTouches[0].clientY - this.touchStartY;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > this.SWIPE_THRESHOLD) {
      // Mirrors: toggleVisibilityonSimple(diffX > 0)
      this.toggleTimerPanel(dx > 0);
    }
  }

  /** Mirrors: toggleVisibilityonSimple — slide in/out relaySensorProgress */
  private toggleTimerPanel(show: boolean): void {
    this.timerPanelVisible = show;
  }

  // ── Difficulty helpers ────────────────────────────────────────────────────
  private setDifficulty(difficulty: string): void {
    if (difficulty === 'Beginner') {
      this.difficultyClass = 'difficulty-beginner';
      this.difficultyIconPath = 'assets/images/body-class-icons/ic_easy_body_class.svg';
    } else if (difficulty === 'Advanced') {
      this.difficultyClass = 'difficulty-advanced';
      this.difficultyIconPath = 'assets/images/body-class-icons/ic_hard_body_class.svg';
    } else {
      this.difficultyClass = 'difficulty-intermediate';
      this.difficultyIconPath = 'assets/images/body-class-icons/ic_medium_body_class.svg';
    }
  }

  isMindAudioType(type: string): boolean {
    return (type || '').trim().toLowerCase() === 'audio';
  }

  private resolveVideoSrc(video: VideoModel | null): string {
    if (!video) return '';
    const raw =
      video.videoLinkiPhonex ||
      video.videoLinkiPhone ||
      video.videoLinkiPad ||
      video.streamingUrlIphonex ||
      video.streamingUrlIpad ||
      video.streamingUrl ||
      '';

    return this.normalizeUrl(raw);
  }

  private normalizeUrl(url: string): string {
    const value = (url || '').trim();
    if (!value) return '';

    // Browsers block mixed content; normalize legacy http links.
    const normalized = value.startsWith('http://') ? value.replace('http://', 'https://') : value;
    return this.withCacheBuster(normalized);
  }

  /** Skip cache-buster when URL may be signed or tokenized (breaks strict CDNs). */
  private urlLooksSignedOrTokenized(url: string): boolean {
    const lower = url.toLowerCase();
    const patterns = [
      'token=',
      'signature=',
      'expires=',
      'policy=',
      'key-pair-id=',
      'x-amz-signature=',
      'x-amz-credential=',
      'sig=',
      'access_token=',
    ];
    return patterns.some((p) => lower.includes(p));
  }

  private withCacheBuster(url: string): string {
    if (this.urlLooksSignedOrTokenized(url)) {
      return url;
    }
    const cacheKey = `_cb=${Date.now()}`;
    return url.includes('?') ? `${url}&${cacheKey}` : `${url}?${cacheKey}`;
  }

  private tryPlayFromUserGesture(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video) return;

    this.autoplayMuted = false;
    video.muted = false;
    void video
      .play()
      .then(() => {
        this.zone.run(() => {
          this.showTapToPlayHint = false;
          this.updateRemainingTime();
          this.startTimer();
        });
      })
      .catch(() => {
        this.autoplayMuted = true;
        video.muted = true;
        void video.play().then(() => {
          this.zone.run(() => {
            this.showTapToPlayHint = false;
            this.updateRemainingTime();
            this.startTimer();
          });
        }).catch(() => {});
      });
  }

  // ── Orientation helpers ───────────────────────────────────────────────────
  private async lockLandscape(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) {
        await ScreenOrientation.lock({ orientation: 'landscape-primary' });
        return;
      }
      await (window.screen as any).orientation?.lock?.('landscape');
    } catch {
      // Ignore unsupported devices/platforms.
    }
  }

  private async unlockOrientation(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) {
        await ScreenOrientation.unlock();
        return;
      }
      (window.screen as any).orientation?.unlock?.();
    } catch {
      // Ignore unsupported devices/platforms.
    }
  }

  private startLandscapeEnforcer(): void {
    if (this.orientationEnforcer) return;
    this.orientationEnforcer = setInterval(() => {
      if (!this.isOrientationLockActive) return;
      void this.lockLandscape();
    }, 1200);

    // Re-apply lock when app returns to foreground.
    if (!this.resumeListenerHandle) {
      App.addListener('resume', () => {
        if (this.isOrientationLockActive) {
          void this.forceLandscapeLock();
        }
      }).then((handle) => {
        this.resumeListenerHandle = handle;
      });
    }
  }

  private stopLandscapeEnforcer(): void {
    if (this.orientationEnforcer) {
      clearInterval(this.orientationEnforcer);
      this.orientationEnforcer = null;
    }
    if (this.resumeListenerHandle) {
      void this.resumeListenerHandle.remove();
      this.resumeListenerHandle = null;
    }
  }

  private async forceLandscapeLock(): Promise<void> {
    // Some devices ignore first lock during transitions; retry quickly.
    await this.lockLandscape();
    setTimeout(() => { if (this.isOrientationLockActive) void this.lockLandscape(); }, 250);
    setTimeout(() => { if (this.isOrientationLockActive) void this.lockLandscape(); }, 800);
    setTimeout(() => { if (this.isOrientationLockActive) void this.lockLandscape(); }, 1500);
    this.updateVisualLandscapeFallback();
  }

  private updateVisualLandscapeFallback(): void {
    const isPortraitViewport = window.innerHeight > window.innerWidth;
    this.forceLandscapeVisualFallback = this.isOrientationLockActive && isPortraitViewport;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  private clearTimers(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.stopPlaybackTimer();
  }
}
