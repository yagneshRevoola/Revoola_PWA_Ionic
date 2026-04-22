import {
  Component,
  OnInit,
  OnDestroy,
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
export class BodyClassVideoPage implements OnInit, OnDestroy {
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

  // Pause state (mirrors pauseVideo)
  isPaused = false;

  // Timer display (mirrors txt_number)
  remainingTime = '00:00';

  // Sensor/timer panel on left (mirrors relaySensorProgress visibility)
  timerPanelVisible = true;

  // Upgrade dialog
  showUpgradeDialog = false;
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

  // Swipe gesture tracking (mirrors SwipeGestureListener)
  private touchStartX = 0;
  private touchStartY = 0;
  private readonly SWIPE_THRESHOLD = 50;

  // Play Store package (mirrors FULL_APP_PACKAGE)
  private readonly FULL_APP_PACKAGE = 'com.revoola';

  constructor(
    private router: Router,
    private zone: NgZone
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
    this.isOrientationLockActive = true;
    this.updateVisualLandscapeFallback();
    this.startLandscapeEnforcer();
    await this.forceLandscapeLock();
  }

  async ionViewDidEnter(): Promise<void> {
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
    const passedVideoUrl = this.normalizeUrl(state?.['videoUrl'] ?? state?.['videoId'] ?? '');
    this.isMindVideo = Boolean(state?.['isMindVideo']);

    if (state?.['videoData']) {
      try {
        this.videoData = JSON.parse(state['videoData']) as VideoModel;
        this.videoId = state['videoId'] ?? '';
        this.videoSrc = passedVideoUrl || this.resolveVideoSrc(this.videoData);
        this.setDifficulty(this.videoData?.difficulty ?? '');
        return !!this.videoSrc;
      } catch (e) {
        console.error('[BodyClassVideo] State parse error:', e);
      }
    }

    if (passedVideoUrl) {
      this.videoSrc = passedVideoUrl;
      return true;
    }

    return false;
  }

  // ── After view — start video + countdown ─────────────────────────────────
  ngAfterViewInit(): void {
    this.startCountdown();
    // Ensure orientation lock is re-applied once DOM/video area is mounted.
    void this.forceLandscapeLock();
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
          this.startPlaybackIfReady();
        }
      });
    }, 1000);
  }

  // ── Video events ──────────────────────────────────────────────────────────

  /** Mirrors: setOnPreparedListener { mediaPlayer.start(); startTimer() } */
  onVideoCanPlay(): void {
    if (this.playbackInitialized) return;
    this.isVideoReadyToStart = true;
    this.startPlaybackIfReady();
  }

  private startPlaybackIfReady(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video || this.playbackInitialized) return;
    if (this.countdownVisible || !this.isVideoReadyToStart) return;
    this.playbackInitialized = true;

    // Some devices apply orientation reliably only when media starts.
    void this.forceLandscapeLock();

    video.play().catch(() => {});
    this.controlsVisible = false;
    this.updateRemainingTime();
    this.startTimer();
  }

  /** Mirrors: updateSeekBarRunnable */
  private startTimer(): void {
    this.timerInterval = setInterval(() => {
      this.zone.run(() => this.updateRemainingTime());
    }, 1000);
  }

  private updateRemainingTime(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video) return;
    const remaining = (video.duration - video.currentTime) * 1000;
    this.remainingTime = this.formatTime(remaining);
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
      this.isPaused = true;
    } else {
      this.autoplayMuted = false;
      video.muted = false;
      video.play().catch(() => {});
      this.isPaused = false;
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
    this.showUpgradeDialog = true;
  }

  // ── Upgrade dialog actions ────────────────────────────────────────────────
  openPlayStore(): void {
    this.showUpgradeDialog = false;
    const url = `https://play.google.com/store/apps/details?id=${this.FULL_APP_PACKAGE}`;
    window.open(url, '_blank');
    this.navigateHome();
  }

  dismissDialog(): void {
    this.showUpgradeDialog = false;
    this.navigateHome();
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

  getMindIconName(type: string): string {
    return (type || '').trim().toLowerCase() === 'audio'
      ? 'headset-outline'
      : 'videocam-outline';
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
    return value.startsWith('http://') ? value.replace('http://', 'https://') : value;
  }

  private tryPlayFromUserGesture(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video) return;

    this.autoplayMuted = false;
    video.muted = false;
    video.play().catch(() => {
      // If unmuted playback is blocked, keep silent autoplay as fallback.
      this.autoplayMuted = true;
      video.muted = true;
      video.play().catch(() => {});
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
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }
}
