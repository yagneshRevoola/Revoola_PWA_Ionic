import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'splash',
    pathMatch: 'full',
  },
  {
    path: 'splash',
    loadComponent: () =>
      import('./pages/splash/splash.page').then((m) => m.SplashPage),
  },
  {
    path: 'body-class-view',
    loadComponent: () =>
      import('./pages/body-class-view/body-class-view.page').then(
        (m) => m.BodyClassViewPage
      ),
  },
  {
    path: 'body-class-video',
    loadComponent: () =>
      import('./pages/body-class-video/body-class-video.page').then(
        (m) => m.BodyClassVideoPage
      ),
  },
  // Fallback
  {
    path: '**',
    redirectTo: 'splash',
  },
];
