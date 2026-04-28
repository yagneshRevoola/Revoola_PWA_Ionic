import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { PwaInstallService } from '../../services/pwa-install.service';

/**
 * Mirrors SplashBodyClassFragment.
 * Shows logo + "The Best You" for 2 seconds then navigates to install-choice.
 */
@Component({
  selector: 'app-splash',
  standalone: true,
  imports: [IonContent, CommonModule],
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
})
export class SplashPage implements OnInit, OnDestroy {
  private timer: ReturnType<typeof setTimeout> | null = null;
  isDesktop = false;
  readonly cacheBuster = Date.now();

  constructor(
    private router: Router,
    private pwaInstallService: PwaInstallService
  ) {}

  ngOnInit(): void {
    this.isDesktop = this.checkDesktopView();

    // Desktop: show only static message, no splash flow.
    if (this.isDesktop) {
      return;
    }

    // Force portrait — same as RLToolsBodyClass.rl_screenSet(false, activity)
    this.lockPortrait();
    this.pwaInstallService.init();

    // Navigate after 2 seconds — same as Handler(Looper.getMainLooper()).postDelayed({ navigate }, 2000)
    this.timer = setTimeout(() => {
      const nextRoute = this.pwaInstallService.isPwaInstalled()
        ? '/body-class-view'
        : '/app-install-choice';
      this.router.navigate([nextRoute], { replaceUrl: true });
    }, 2000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private lockPortrait(): void {
    try {
      const screen = window.screen as Screen & { orientation?: { lock: (o: string) => Promise<void> } };
      if (screen?.orientation?.lock) {
        screen.orientation.lock('portrait').catch(() => {/* ignore on desktop */});
      }
    } catch {
      // Not all browsers support this; silently skip
    }
  }

  private checkDesktopView(): boolean {
    try {
      return window.matchMedia('(min-width: 992px)').matches;
    } catch {
      return false;
    }
  }

  cacheBustAsset(path: string): string {
    const value = (path || '').trim();
    if (!value) return '';
    const cacheKey = `_cb=${this.cacheBuster}`;
    return value.includes('?') ? `${value}&${cacheKey}` : `${value}?${cacheKey}`;
  }
}
