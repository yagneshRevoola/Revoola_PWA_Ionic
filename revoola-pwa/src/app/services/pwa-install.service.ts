import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private isInstalled = false;
  private hasListeners = false;

  readonly installState$ = new BehaviorSubject<{
    canInstall: boolean;
    isInstalled: boolean;
  }>({ canInstall: false, isInstalled: false });

  constructor(private ngZone: NgZone) {}

  init(): void {
    if (this.hasListeners) return;
    this.hasListeners = true;
    this.isInstalled = this.detectStandaloneMode();

    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      this.deferredInstallPrompt = event as BeforeInstallPromptEvent;
      this.ngZone.run(() => this.emitState());
    });

    window.addEventListener('appinstalled', () => {
      this.ngZone.run(() => {
        this.isInstalled = true;
        this.deferredInstallPrompt = null;
        this.emitState();
      });
    });

    this.emitState();
  }

  canPromptInstall(): boolean {
    return !!this.deferredInstallPrompt && !this.isInstalled;
  }

  isPwaInstalled(): boolean {
    return this.isInstalled || this.detectStandaloneMode();
  }

  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferredInstallPrompt || this.isInstalled) {
      return 'unavailable';
    }
    await this.deferredInstallPrompt.prompt();
    const choiceResult = await this.deferredInstallPrompt.userChoice;

    if (choiceResult.outcome === 'accepted') {
      this.isInstalled = true;
    }
    this.deferredInstallPrompt = null;
    this.ngZone.run(() => this.emitState());
    return choiceResult.outcome;
  }

  private emitState(): void {
    this.installState$.next({
      canInstall: this.canPromptInstall(),
      isInstalled: this.isPwaInstalled(),
    });
  }

  private detectStandaloneMode(): boolean {
    try {
      const mediaMatch = window.matchMedia('(display-mode: standalone)').matches;
      const navigatorStandalone =
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      return mediaMatch || navigatorStandalone;
    } catch {
      return false;
    }
  }
}
