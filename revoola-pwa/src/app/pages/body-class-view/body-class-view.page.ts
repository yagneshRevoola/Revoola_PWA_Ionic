import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ToastController } from '@ionic/angular';
import {
  IonContent,
  IonSpinner,
} from '@ionic/angular/standalone';

import { FirebaseService } from '../../services/firebase.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { VideoModel } from '../../models/video.model';

/**
 * Mirrors BodyClassViewFragment.
 * - Fetches video data from Firebase on load (hardcoded key)
 * - Shows scrollable detail: banner, stats, worklog, description, trainer
 * - Fixed "START CLASS" button navigates to video page with JSON payload
 */
@Component({
  selector: 'app-body-class-view',
  standalone: true,
  imports: [CommonModule, IonContent, IonSpinner],
  templateUrl: './body-class-view.page.html',
  styleUrls: ['./body-class-view.page.scss'],
})
export class BodyClassViewPage implements OnInit, OnDestroy {
  videoData: VideoModel | null = null;
  isLoading = true;
  hasError = false;
  isMindVideo = false;
  canInstallPwa = false;
  isPwaInstalled = false;
  isInstallInProgress = false;
  installStatusMessage = '';
  installStatusType: 'success' | 'warning' | 'error' | 'info' = 'info';
  isBrowserLaunch = true;

  private sub?: Subscription;
  private pwaStateSub?: Subscription;
  private readonly storageVideoKey = 'revoola:lastVideoKey';

  // Mirrors Android default key; can be overridden by URL param/query.

  constructor(
    private firebase: FirebaseService,
    private route: ActivatedRoute,
    private router: Router,
    private pwaInstallService: PwaInstallService,
    private toastController: ToastController
  ) {}

  ngOnInit(): void {
    this.isBrowserLaunch = this.detectBrowserLaunch();
    this.lockPortrait();
    this.pwaInstallService.init();
    if (!this.pwaInstallService.isPwaInstalled()) {
      // Preserve deep-link id so the class can still be opened after install.
      this.storeVideoKey(this.getRequestedVideoKey());
      this.router.navigate(['/app-install-choice'], { replaceUrl: true });
      return;
    }
    this.setupPwaInstallState();
    this.loadVideoData();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.pwaStateSub?.unsubscribe();
  }

  // ── Firebase fetch — mirrors databaseManager.rl_readData(...) ─────────────
  private loadVideoData(): void {
    this.isLoading = true;
    this.hasError = false;
    const requestedVideoKey = this.getRequestedVideoKey();
    this.isMindVideo = this.shouldUseMindLayout(requestedVideoKey);
    if (!requestedVideoKey) {
      this.hasError = true;
      this.isLoading = false;
      console.warn('[BodyClassView] Missing video key in URL/query/storage.');
      return;
    }

    this.sub = this.firebase
      .getBodyClassVideo(requestedVideoKey)
      .subscribe({
        next: (data) => {
          console.log('[BodyClassView] Video data:', data);
          this.videoData = data;
          this.isLoading = false;
        },
        error: (err) => {
          console.error('[BodyClassView] Firebase error:', err);
          this.hasError = true;
          this.isLoading = false;
        },
      });
  }

  private getRequestedVideoKey(): string {
    const pathVideoKey = (this.route.snapshot.paramMap.get('videoId') ?? '').trim();
    const queryVideoKey = (this.route.snapshot.queryParamMap.get('videoId') ?? '').trim();
    const pathnameKey = this.getVideoKeyFromPathname();
    const resolvedKey =
      queryVideoKey ||
      pathVideoKey ||
      pathnameKey ||
      this.getStoredVideoKey();

    this.storeVideoKey(resolvedKey);
    return resolvedKey;
  }

  private getVideoKeyFromPathname(): string {
    const rawPath = (window.location.pathname || '').replace(/^\/+|\/+$/g, '');
    if (!rawPath) return '';

    const firstSegment = decodeURIComponent(rawPath.split('/')[0] || '').trim();
    if (!firstSegment) return '';

    // Ignore known app routes so only deep-link IDs are treated as video keys.
    const reservedRoutes = new Set([
      'splash',
      'app-install-choice',
      'body-class-view',
      'body-class-video',
    ]);
    return reservedRoutes.has(firstSegment) ? '' : firstSegment;
  }

  private getStoredVideoKey(): string {
    try {
      return (localStorage.getItem(this.storageVideoKey) ?? '').trim();
    } catch {
      return '';
    }
  }

  private storeVideoKey(videoKey: string): void {
    const value = (videoKey || '').trim();
    if (!value) return;
    try {
      localStorage.setItem(this.storageVideoKey, value);
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }

  private shouldUseMindLayout(videoKey: string): boolean {
    return (videoKey || '').toLowerCase().includes('mind');
  }

  // ── Navigation — mirrors findNavController().navigate(bodyView_to_bodyVideo) ─
  startClass(): void {
    const defaultVideoUrl = this.videoData?.streamingUrl || '';
    if (!this.videoData) {
      // Keep navigation responsive even if data hydration is delayed.
      this.router.navigate(['/body-class-video'], {
        state: { videoUrl: defaultVideoUrl },
        replaceUrl: true,
      });
      return;
    }
    this.router.navigate(['/body-class-video'], {
      state: {
        videoData: JSON.stringify(this.videoData),
        videoUrl: defaultVideoUrl,
      },
      replaceUrl: true,
    });
  }

  // ── Back — mirrors stopButtonProcess() ───────────────────────────────────
  goBack(): void {
    // On PWA there's no native back-stack pop on the very first screen;
    // navigate to splash as the equivalent of popBackStack()
    history.back();
  }

  // ── Difficulty helpers (same logic as RLBodyUiSetup) ─────────────────────
  getDifficultyClass(difficulty: string): string {
    if (difficulty === 'Beginner') return 'difficulty-beginner';
    if (difficulty === 'Advanced') return 'difficulty-advanced';
    return 'difficulty-intermediate';
  }

  getDifficultyIconPath(difficulty: string): string {
    if (difficulty === 'Beginner') return 'assets/images/body-class-icons/ic_easy_body_class.svg';
    if (difficulty === 'Advanced') return 'assets/images/body-class-icons/ic_hard_body_class.svg';
    return 'assets/images/body-class-icons/ic_medium_body_class.svg';
  }

  async installPwa(): Promise<void> {
    if (this.isPwaInstalled || this.isInstallInProgress) {
      return;
    }

    let installOutcome: 'accepted' | 'dismissed' | 'unavailable' | 'error' | 'timeout' = 'unavailable';
    const installStartAt = Date.now();
    this.isInstallInProgress = true;
    try {
      const choiceResult = await this.withTimeout(
        this.pwaInstallService.promptInstall(),
        15000
      );
      installOutcome = choiceResult ?? 'timeout';
      if (choiceResult === 'accepted') {
        this.isPwaInstalled = true;
      }
    } catch (error) {
      console.error('[BodyClassView] Install prompt failed:', error);
      installOutcome = 'error';
    } finally {
      await this.ensureMinLoaderDuration(installStartAt, 900);
      this.isInstallInProgress = false;
    }

    await this.presentInstallOutcomePopup(installOutcome);
  }

  private setupPwaInstallState(): void {
    this.pwaInstallService.init();

    this.pwaStateSub = this.pwaInstallService.installState$.subscribe((state) => {
      this.canInstallPwa = state.canInstall;
      this.isPwaInstalled = state.isInstalled;
      if (this.isPwaInstalled) {
        this.isInstallInProgress = false;
      }
    });
  }

  private async presentInstallOutcomePopup(
    outcome: 'accepted' | 'dismissed' | 'unavailable' | 'error' | 'timeout'
  ): Promise<void> {
    if (outcome === 'accepted') {
      await this.presentInstallToast('Your app was added to the home screen successfully.', 'success');
      return;
    }
    if (outcome === 'dismissed') {
      await this.presentInstallToast('Installation was cancelled. You can try again from the same button.', 'warning');
      return;
    }
    if (outcome === 'timeout') {
      await this.presentInstallToast('Install dialog did not complete. Please try again.', 'warning');
      return;
    }
    if (outcome === 'unavailable') {
      await this.presentInstallToast('Install prompt is not available right now. Please use Android Chrome and check PWA criteria.', 'medium');
      return;
    }
    await this.presentInstallToast('Something went wrong while installing. Please try again.', 'danger');
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async ensureMinLoaderDuration(startAt: number, minMs: number): Promise<void> {
    const elapsed = Date.now() - startAt;
    const wait = Math.max(0, minMs - elapsed);
    if (wait > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
  }

  private async presentInstallToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium'
  ): Promise<void> {
    this.installStatusMessage = message;
    this.installStatusType = this.mapToastColorToStatusType(color);

    try {
      const toast = await this.toastController.create({
        message,
        duration: 2500,
        color,
        position: 'bottom',
      });
      await toast.present();
    } catch {
      window.alert(message);
    }
  }

  clearInstallStatus(): void {
    this.installStatusMessage = '';
  }

  private mapToastColorToStatusType(
    color: 'success' | 'warning' | 'danger' | 'medium'
  ): 'success' | 'warning' | 'error' | 'info' {
    if (color === 'success') return 'success';
    if (color === 'warning') return 'warning';
    if (color === 'danger') return 'error';
    return 'info';
  }

  private lockPortrait(): void {
    try {
      (window.screen as any).orientation?.lock('portrait').catch(() => {});
    } catch { /* desktop */ }
  }

  private detectBrowserLaunch(): boolean {
    try {
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const inStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        !!nav.standalone;
      return !inStandaloneMode;
    } catch {
      return true;
    }
  }
}
