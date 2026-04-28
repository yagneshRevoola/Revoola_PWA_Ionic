import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { PwaInstallService } from '../../services/pwa-install.service';

@Component({
  selector: 'app-app-install-choice',
  standalone: true,
  imports: [CommonModule, IonContent, IonSpinner],
  templateUrl: './app-install-choice.page.html',
  styleUrls: ['./app-install-choice.page.scss'],
})
export class AppInstallChoicePage implements OnInit, OnDestroy {
  canInstallPwa = false;
  isPwaInstalled = false;
  isInstallInProgress = false;
  installStatusMessage = '';
  installStatusType: 'success' | 'warning' | 'error' | 'info' = 'info';
  variant: 'mind' | 'body' = 'mind';
  readonly cacheBuster = Date.now();

  private pwaStateSub?: Subscription;
  private readonly FULL_APP_PACKAGE = 'com.revoola';
  private readonly storageVideoKey = 'revoola:lastVideoKey';

  constructor(
    private router: Router,
    private pwaInstallService: PwaInstallService,
    private toastController: ToastController
  ) {}

  ngOnInit(): void {
    this.pwaInstallService.init();
    if (this.pwaInstallService.isPwaInstalled()) {
      this.router.navigate(['/body-class-view'], { replaceUrl: true });
      return;
    }
    this.variant = this.detectVariant();
    this.setupPwaInstallState();
  }

  // Mirrors shouldUseMindLayout in body-class-view.page.ts:
  // videoId contains 'm' (case-insensitive) → mind, else → body.
  private detectVariant(): 'mind' | 'body' {
    let key = '';
    try {
      key = (localStorage.getItem(this.storageVideoKey) ?? '').trim();
    } catch {
      /* private mode / quota — fall through to default */
    }
    return key.toLowerCase().includes('m') ? 'mind' : 'body';
  }

  ngOnDestroy(): void {
    this.pwaStateSub?.unsubscribe();
  }

  goToFullVersion(): void {
    this.router.navigate(['/body-class-view'], { replaceUrl: true });
  }

  openPlayStore(): void {
    const url = this.withCacheBuster(
      `https://play.google.com/store/apps/details?id=${this.FULL_APP_PACKAGE}`
    );
    window.open(url, '_blank');
  }

  cacheBustAsset(path: string): string {
    return this.withCacheBuster(path);
  }

  async installAppClip(): Promise<void> {
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
      console.error('[AppInstallChoice] Install prompt failed:', error);
      installOutcome = 'error';
    } finally {
      await this.ensureMinLoaderDuration(installStartAt, 900);
      this.isInstallInProgress = false;
    }

    await this.presentInstallOutcomePopup(installOutcome);
  }

  clearInstallStatus(): void {
    this.installStatusMessage = '';
  }

  private setupPwaInstallState(): void {
    this.pwaStateSub = this.pwaInstallService.installState$.subscribe((state) => {
      this.canInstallPwa = state.canInstall;
      this.isPwaInstalled = state.isInstalled;
      if (this.isPwaInstalled) {
        this.isInstallInProgress = false;
       // this.router.navigate(['/body-class-view'], { replaceUrl: true });
      }
    });
  }

  private async presentInstallOutcomePopup(
    outcome: 'accepted' | 'dismissed' | 'unavailable' | 'error' | 'timeout'
  ): Promise<void> {
    if (outcome === 'accepted') {
      await this.presentInstallToast('Your app has been added to the home screen successfully. You can now access it directly from your home screen.', 'success');
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

  private mapToastColorToStatusType(
    color: 'success' | 'warning' | 'danger' | 'medium'
  ): 'success' | 'warning' | 'error' | 'info' {
    if (color === 'success') return 'success';
    if (color === 'warning') return 'warning';
    if (color === 'danger') return 'error';
    return 'info';
  }

  private withCacheBuster(url: string): string {
    const value = (url || '').trim();
    if (!value) return '';
    const cacheKey = `_cb=${this.cacheBuster}`;
    return value.includes('?') ? `${value}&${cacheKey}` : `${value}?${cacheKey}`;
  }
}
