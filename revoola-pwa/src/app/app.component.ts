import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { PwaInstallService } from './services/pwa-install.service';
import { PosthogService } from './services/posthog.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
})
export class AppComponent {
  constructor(
    private pwaInstallService: PwaInstallService,
    private posthogService: PosthogService
  ) {
    this.pwaInstallService.init();
    void this.setupPosthog();
  }

  private async setupPosthog(): Promise<void> {
    try {
      await this.posthogService.capture('test-event');
    } catch (error) {
      console.error('[PosthogService] setup/capture failed', error);
    }
  }
}
