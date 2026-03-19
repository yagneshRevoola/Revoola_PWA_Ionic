import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';

/**
 * Mirrors SplashBodyClassFragment.
 * Shows logo + "The Best You" for 2 seconds then navigates to body-class-view.
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

  constructor(private router: Router) {}

  ngOnInit(): void {
    // Force portrait — same as RLToolsBodyClass.rl_screenSet(false, activity)
    this.lockPortrait();

    // Navigate after 2 seconds — same as Handler(Looper.getMainLooper()).postDelayed({ navigate }, 2000)
    this.timer = setTimeout(() => {
      this.router.navigate(['/body-class-view'], { replaceUrl: true });
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
}
