import { Injectable } from '@angular/core';
import { Posthog } from '@capawesome/capacitor-posthog';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PosthogService {
  private setupPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.setupPromise) {
      this.setupPromise = Posthog.setup({
        apiKey: environment.posthogApiKey,
        host: environment.posthogHost,
      });
    }

    return this.setupPromise;
  }

  async capture(event: string, properties?: Record<string, unknown>): Promise<void> {
    await this.init();
    await Posthog.capture({ event, properties });
  }
}
