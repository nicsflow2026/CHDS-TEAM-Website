# CHDS V7 responsive design

Mobile-first CSS with fluid type (`clamp()`), fluid grids (`repeat(auto-fill, minmax(min(…,100%),1fr))`) and a few
breakpoints. Every page is checked at the 13 widths required for V7:

**320 · 360 · 375 · 390 · 430 · 480 · 768 · 820 · 1024 · 1280 · 1366 · 1440 · 1920 px**

## Breakpoints

| Width | Public site | Dashboard | Admin Login |
|---|---|---|---|
| ≤ 360 px | tighter chat header, compact controls | — | single card |
| ≤ 480 px | stacked security notice, uploader actions wrap | compact spacing | single card |
| ≤ 560 px | chat becomes a full-screen sheet; lightbox arrows move under the photo | — | — |
| ≤ 640 px | ambient background removed (lighter on low-power phones) | — | — |
| ≤ 760 px | — | tables become stacked cards | — |
| ≤ 860 px | mobile navigation drawer with scrim and scroll lock | — | brand panel hidden |
| ≤ 1023 px | — | sidebar becomes an off-canvas drawer with scrim and scroll lock | — |
| ≥ 1440 px | content width capped (`.container`), extra space left as margin | content capped at 1500 px | split layout capped at 1000 px |

## Mobile specifics

* **Safe areas:** header, chat launcher and panel, lightbox, login and drawers use `env(safe-area-inset-*)`.
* **Touch targets:** buttons, nav items, chat controls, upload actions and lightbox controls are at least 40–44 px.
* **No hover-only interactions:** hover effects are wrapped in `@media (hover:hover)`; carousel arrows stay visible on touch devices; swipe works in the lightbox.
* **Forms:** inputs use 16 px text (no iOS zoom), labels stay visible, the portal groups fields into four sections that stack on narrow screens.
* **Tables:** dashboard tables turn into stacked cards at 760 px and below; wide content scrolls inside its own container, never the page.
* **Modals:** dialogs are capped at `calc(100vw - 24px)` and `100dvh`; drawers become full-width on phones.
* **Images:** fixed aspect-ratio frames (4:3 gallery, 4:3 evidence thumbnails) prevent distortion and layout shift; width/height attributes come from the server.

## Desktop specifics

Refined hover states, two-column Admin Login with a brand panel, balanced card grids, sticky dashboard top bar,
readable table density, and content width limits so text lines stay readable on 1920 px displays.

## Verification

`tests/visual/run_v7.py` (V7), `run_v6.py` (V6 features) and `run_visual.py` (all pages and dashboard views)
check, at each width: no horizontal overflow, panels and modals inside the viewport, navigation working, galleries
intact and forms usable. Results are in TEST_REPORT.md. Real-device testing (Safari, Firefox, physical phones) was
**not** performed; only headless Chromium was available.
