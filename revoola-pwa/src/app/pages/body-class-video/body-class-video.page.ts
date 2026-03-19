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

  // Difficulty
  difficultyClass = '';
  difficultyIcon = '';

  // ── Private ──────────────────────────────────────────────────────────────
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private playbackInitialized = false;

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
    this.lockLandscape();
    const hasState = this.readNavState();
    if (!hasState) {
      this.loadFallbackVideo();
    }
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.unlockOrientation();
    this.restoreStatusBar();
  }

  // ── Navigation state ─────────────────────────────────────────────────────
  private readNavState(): boolean {
    const nav = this.router.getCurrentNavigation();
    const state = nav?.extras?.state ?? history.state;

    if (state?.['videoData']) {
      try {
        this.videoData = JSON.parse(state['videoData']) as VideoModel;
        this.videoId = state['videoId'] ?? '';
        this.videoSrc = this.videoData?.videoLinkiPhonex ?? '';
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
        this.videoSrc = data?.videoLinkiPhonex ?? '';
        this.setDifficulty(data?.difficulty ?? '');
      },
      error: (err) => {
        console.error('[BodyClassVideo] Fallback load error:', err);
      },
    });
  }

  // ── After view — start video + countdown ─────────────────────────────────
  ngAfterViewInit(): void {
    this.hideStatusBar();
    this.startCountdown();
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
    this.restoreStatusBar();
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
      this.difficultyIcon = '🟢';
    } else if (difficulty === 'Advanced') {
      this.difficultyClass = 'difficulty-advanced';
      this.difficultyIcon = '🔴';
    } else {
      this.difficultyClass = 'difficulty-intermediate';
      this.difficultyIcon = '🟠';
    }
  }

  // ── Orientation helpers ───────────────────────────────────────────────────
  private lockLandscape(): void {
    try {
      (window.screen as any).orientation?.lock('landscape').catch(() => {});
    } catch { /* desktop — ignore */ }
  }

  private unlockOrientation(): void {
    try {
      (window.screen as any).orientation?.unlock();
    } catch { /* ignore */ }
  }

  // ── Status bar helpers — mirrors SYSTEM_UI_FLAG_FULLSCREEN ────────────────
  private hideStatusBar(): void {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  private restoreStatusBar(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  private clearTimers(): void {
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }
}
