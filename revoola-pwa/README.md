# Revoola Body Class — Ionic + Angular PWA

> Exact 1:1 conversion of the native Android app to a production-ready Ionic 7 + Angular 17 PWA.

---

## Project Structure

```
src/
├── index.html                       # PWA meta, manifest, Ionicons CDN
├── main.ts                          # Bootstrap: Ionic, HttpClient, ServiceWorker
├── global.scss                      # Brand CSS variables + shared styles
├── manifest.webmanifest             # Installable PWA manifest
├── ngsw-config.json                 # Service Worker (offline + Firebase cache)
├── environments/
│   ├── environment.ts               # Dev: Firebase URL + base path
│   └── environment.prod.ts          # Prod config
└── app/
    ├── app.component.ts             # IonApp + IonRouterOutlet
    ├── app.routes.ts                # splash → body-class-view → body-class-video
    ├── models/
    │   └── video.model.ts           # 1:1 mirror of RLFulllVideoModelBodyClass
    ├── services/
    │   └── firebase.service.ts      # REST API — mirrors RLDatabaseManagerReadBodyClass
    │                                #           + RevoolaFirebasePathBodyClass
    └── pages/
        ├── splash/                  # ← SplashBodyClassFragment
        │   ├── splash.page.ts       #   2s timer, portrait lock
        │   ├── splash.page.html     #   logo + "The Best You" + tagline
        │   └── splash.page.scss     #   white bg, centred layout
        ├── body-class-view/         # ← BodyClassViewFragment
        │   ├── body-class-view.page.ts    # Firebase fetch, navigation
        │   ├── body-class-view.page.html  # Banner, stats card, worklog, desc, trainer
        │   └── body-class-view.page.scss  # Exact XML layout replica
        └── body-class-video/        # ← BodyClassVideoFragment
            ├── body-class-video.page.ts   # Video, countdown, swipe, upgrade dialog
            ├── body-class-video.page.html # Player + all overlays
            └── body-class-video.page.scss # All 4 XML includes replicated
```

---

## Android → PWA Mapping

| Android | PWA |
|---|---|
| `SplashBodyClassFragment` | `SplashPage` |
| `BodyClassViewFragment` | `BodyClassViewPage` |
| `BodyClassVideoFragment` | `BodyClassVideoPage` |
| `RLDatabaseManagerReadBodyClass` | `FirebaseService` (REST) |
| `RevoolaFirebasePathBodyClass` | `FirebaseService` path methods |
| `RLFulllVideoModelBodyClass` | `VideoModel` interface |
| `RLToolsBodyClass.rl_screenSet()` | `Screen Orientation API` |
| `CountDownTimer` | `setInterval` + zone.run |
| `Handler.postDelayed` | `setTimeout` |
| `GestureDetector (onFling)` | `touchstart` / `touchend` |
| `VideoView` | `<video>` element |
| `MaterialAlertDialogBuilder` | Custom dialog overlay |
| `findNavController().navigate()` | `Router.navigate()` |
| `popBackStack()` | `history.back()` |
| `window.decorView FULLSCREEN flags` | `requestFullscreen()` API |
| `setPersistenceEnabled(true)` | `ngsw-config.json` data cache |

---

## Color Variables

| Android resource | CSS variable | Value |
|---|---|---|
| `AppMainColor` / `AppZone3Color` | `--app-main-color` | `#00C896` |
| `AppWhiteColor` | `--app-white` | `#ffffff` |
| `AppBlackColor` | `--app-black` | `#1a1a1a` |
| `AppRedColor` | `--app-red` | `#e53935` |
| `AppOrangeColor` | `--app-orange` | `#ff8c00` |
| `AppTextGrayColor` | `--app-text-gray` | `#888888` |
| `AppLightGrayColor` | `--app-light-gray` | `#e0e0e0` |
| `AppDarkGrayColor` | `--app-dark-gray` | `#555555` |

---

## Setup & Run

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### Install

```bash
npm install -g @ionic/cli
npm install
```

### Development server

```bash
ionic serve
# or
npm start
```

### Production build (with PWA)

```bash
npm run build:pwa
# Output: www/
```

### Serve production build locally

```bash
npm install -g http-server
http-server www -p 8080
```

---

## PWA Features

- **Service Worker** — `ngsw-worker.js` via `@angular/service-worker`
- **Offline support** — App shell cached on install; Firebase responses cached 1h
- **Web Manifest** — `manifest.webmanifest` with all icon sizes
- **Installable** — "Add to Home Screen" on Android Chrome / iOS Safari

---

## Adding App Icons

Place PNG icons in `src/assets/icons/`:
```
icon-72x72.png
icon-96x96.png
icon-128x128.png
icon-144x144.png
icon-152x152.png
icon-192x192.png
icon-384x384.png
icon-512x512.png
```

---

## Extending to Next Screens

When adding more screens from the full Revoola app:

1. Generate: `ionic generate page pages/my-new-page`
2. Add route in `app.routes.ts`
3. Add Firebase path in `FirebaseService`
4. Follow the same standalone component pattern

---

## Notes

- **Font**: Nunito (Google Fonts) is used as the closest freely-available equivalent to Omnes/Aptos used in the native app. Swap in licensed fonts by updating the `@font-face` in `global.scss` and replacing `--font-regular` / `--font-semibold`.
- **Video source**: `videoLinkiPhonex` is used as the primary source (same as Android), falling back gracefully if the URL is unavailable.
- **Orientation lock**: `Screen Orientation API` is used; on desktop browsers this is a no-op (silently ignored), matching the behaviour of `requestedOrientation` on non-mobile.
