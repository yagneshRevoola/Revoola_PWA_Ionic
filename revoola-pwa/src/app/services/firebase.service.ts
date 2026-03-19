import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { VideoModel } from '../models/video.model';

/**
 * Mirrors RevoolaFirebasePathBodyClass + RLDatabaseManagerReadBodyClass.
 * Uses the Firebase REST API instead of the native SDK — no auth required
 * for public/open rules, and keeps the bundle lean.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly base = environment.firebaseDbUrl;
  private readonly path = environment.firebaseBasePath;

  // Hardcoded video key — same as Android: BodyClassViewFragment.videoKey
  readonly DEFAULT_VIDEO_KEY = '20190617-1334-technical-dance-jess-advanced-30';

  constructor(private http: HttpClient) {}

  // ── Path helpers ──────────────────────────────────────────────────────────

  /** proposedstructure/revoolaVideos/{videoId}.json */
  private videoBodyPath(videoId: string): string {
    return `${this.base}/${this.path}/revoolaVideos/${videoId}.json`;
  }

  /** proposedstructure/revoolaVideoKeys/forAll/listOfVideos.json */
  private videoKeyBodyPath(): string {
    return `${this.base}/${this.path}/revoolaVideoKeys/forAll/listOfVideos.json`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Fetch a single body-class video by its key.
   * Mirrors: databaseManager.rl_readData(getVideoBodyPath(videoKey)) { ... }
   */
  getBodyClassVideo(videoId: string): Observable<VideoModel> {
    return this.http.get<VideoModel>(this.videoBodyPath(videoId)).pipe(
      map((data) => {
        if (!data) throw new Error('No data returned from Firebase');
        return data;
      }),
      catchError((err) => {
        console.error('[FirebaseService] getBodyClassVideo error:', err);
        return throwError(() => err);
      })
    );
  }

  /**
   * Fetch the list of video keys (body section).
   */
  getBodyVideoKeys(): Observable<string[]> {
    return this.http.get<Record<string, string>>(this.videoKeyBodyPath()).pipe(
      map((data) => (data ? Object.values(data) : [])),
      catchError((err) => {
        console.error('[FirebaseService] getBodyVideoKeys error:', err);
        return throwError(() => err);
      })
    );
  }
}
