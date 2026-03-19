import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  IonContent,
  IonSpinner,
} from '@ionic/angular/standalone';

import { FirebaseService } from '../../services/firebase.service';
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

  private sub?: Subscription;

  // Mirrors: private val videoKey = "20190617-1334-technical-dance-jess-advanced-30"
  private readonly videoKey = this.firebase.DEFAULT_VIDEO_KEY;

  constructor(
    private firebase: FirebaseService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.lockPortrait();
    this.loadVideoData();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ── Firebase fetch — mirrors databaseManager.rl_readData(...) ─────────────
  private loadVideoData(): void {
    this.isLoading = true;
    this.hasError = false;

    this.sub = this.firebase
      .getBodyClassVideo(this.videoKey)
      .subscribe({
        next: (data) => {
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

  // ── Navigation — mirrors findNavController().navigate(bodyView_to_bodyVideo) ─
  startClass(): void {
    if (!this.videoData) {
      // Keep navigation responsive even if data hydration is delayed.
      this.router.navigate(['/body-class-video'], {
        state: { videoId: this.videoKey },
      });
      return;
    }
    this.router.navigate(['/body-class-video'], {
      state: {
        videoData: JSON.stringify(this.videoData),
        videoId: this.videoKey,
      },
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

  getDifficultyIcon(difficulty: string): string {
    if (difficulty === 'Beginner') return '🟢';
    if (difficulty === 'Advanced') return '🔴';
    return '🟠';
  }

  private lockPortrait(): void {
    try {
      (window.screen as any).orientation?.lock('portrait').catch(() => {});
    } catch { /* desktop */ }
  }
}
