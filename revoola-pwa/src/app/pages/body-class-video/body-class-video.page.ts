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
import { IonContent } from '@ionic/angular/standalone';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { VideoModel } from '../../models/video.model';
import { FirebaseService } from '../../services/firebase.service';

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
  imports: [CommonModule, IonContent],
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

  // ── Private ──────────────────────────────────────────────────────────────
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private orientationEnforcer: ReturnType<typeof setInterval> | null = null;
  private resumeListenerHandle: { remove: () => Promise<void> } | null = null;
  private isOrientationLockActive = false;
  private playbackInitialized = false;
  private hasTriedFullscreen = false;

  // Swipe gesture tracking (mirrors SwipeGestureListener)
  private touchStartX = 0;
  private touchStartY = 0;
  private readonly SWIPE_THRESHOLD = 50;

  // Play Store package (mirrors FULL_APP_PACKAGE)
  private readonly FULL_APP_PACKAGE = 'com.revoola';
  private readonly defaultVideoKey: string;

  constructor(
    private router: Router,
    private zone: NgZone,
    private firebase: FirebaseService
  ) {
    this.defaultVideoKey = this.firebase.DEFAULT_VIDEO_KEY;
  }

  ngOnInit(): void {
    const hasState = this.readNavState();
    if (!hasState) {
      this.loadFallbackVideo();
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

    if (state?.['videoData']) {
      try {
        this.videoData = JSON.parse(state['videoData']) as VideoModel;
        this.videoId = state['videoId'] ?? '';
        this.videoSrc = this.resolveVideoSrc(this.videoData);
        this.setDifficulty(this.videoData?.difficulty ?? '');
        return !!this.videoSrc;
      } catch (e) {
        console.error('[BodyClassVideo] State parse error:', e);
      }
    }
    return false;
  }

  private loadFallbackVideo(): void {
    this.videoId = this.defaultVideoKey;
    this.firebase.getBodyClassVideo(this.defaultVideoKey).subscribe({
      next: (data) => {
        this.videoData = data;
        this.videoSrc = this.resolveVideoSrc(data);
        this.setDifficulty(data?.difficulty ?? '');
      },
      error: (err) => {
        console.error('[BodyClassVideo] Fallback load error:', err);
      },
    });
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
        }
      });
    }, 1000);
  }

  // ── Video events ──────────────────────────────────────────────────────────

  /** Mirrors: setOnPreparedListener { mediaPlayer.start(); startTimer() } */
  onVideoCanPlay(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video || this.playbackInitialized) return;
    this.playbackInitialized = true;

    // Some devices apply orientation reliably only when media starts.
    void this.forceLandscapeLock();
    this.tryEnterFullscreenAuto();

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
  toggleControls(): void {
    this.tryEnterFullscreenFromGesture();
    // User gesture unlocks media on web autoplay-restricted browsers.
    this.tryPlayFromUserGesture();
    this.controlsVisible = !this.controlsVisible;
  }

  // ── Pause / Resume — mirrors btnPauseResume.setOnClickListener ────────────
  togglePause(): void {
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
  stopVideo(): void {
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

    // Browsers block mixed content; normalize legacy http links.
    return raw.startsWith('http://') ? raw.replace('http://', 'https://') : raw;
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

  private tryEnterFullscreenFromGesture(): void {
    if (this.hasTriedFullscreen) return;
    this.hasTriedFullscreen = true;

    const video = this.videoElRef?.nativeElement as any;
    if (!video) return;

    if (document.fullscreenElement) return;

    // Standard Fullscreen API first.
    if (typeof video.requestFullscreen === 'function') {
      video.requestFullscreen().catch(() => {});
      return;
    }

    // iOS Safari fallback for <video>.
    if (typeof video.webkitEnterFullscreen === 'function') {
      try { video.webkitEnterFullscreen(); } catch { /* ignore */ }
    }
  }

  private tryEnterFullscreenAuto(): void {
    if (this.hasTriedFullscreen) return;
    this.hasTriedFullscreen = true;

    const video = this.videoElRef?.nativeElement as any;
    if (!video) return;

    // Native app can often enter fullscreen without explicit tap.
    if (Capacitor.isNativePlatform()) {
      if (typeof video.requestFullscreen === 'function') {
        video.requestFullscreen().catch(() => {});
        return;
      }
      if (typeof video.webkitEnterFullscreen === 'function') {
        try { video.webkitEnterFullscreen(); } catch { /* ignore */ }
      }
    }
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
