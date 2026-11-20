# CHDS V7 animation system

One shared motion layer serves every page: the public website, Admin Login, the Admin Dashboard, the Report
Portal, Public Reports and AI Support. It lives in the two files every page already loads:

| File | Role |
|---|---|
| `public/assets/ux.css` | motion tokens, keyframes, page transitions, reveal, button states, modal transitions, reduced motion |
| `public/assets/ux.js` (`window.UX`) | `reveal()`, `enter()`, `lockScroll()`, `busy()` / `run()` / `flash()`, `reduced()`, skeletons, request helpers |

Page-specific styling builds on it in `site.css` (public site, portal, reports, chat) and `admin.css` (login, dashboard).
No animation library was added; everything is CSS plus a few lines of JavaScript.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--ux-ease` | `cubic-bezier(.2,.8,.2,1)` | general transitions |
| `--ux-ease-out` | `cubic-bezier(.16,1,.3,1)` | entrances, reveals, drawers |
| `--ux-fast` / `--ux-base` / `--ux-slow` | `.15s` / `.24s` / `.5s` | press feedback / hovers / entrances |
| `--ux-rise` | `14px` | entrance distance |

Only `transform` and `opacity` are animated for movement (GPU-friendly). Colour, border and shadow changes use
short transitions. Looping effects (ambient glow, spinners, skeleton shimmer) are decorative and stop under reduced motion.

## Components

| Area | Behaviour | Where |
|---|---|---|
| Page transitions | Cross-document View Transitions (`@view-transition { navigation: auto }`): old page fades out (160 ms), new page fades and rises in (340 ms). Back/forward navigation is native and untouched; browsers without support simply navigate. A thin top progress bar shows during navigation. | `ux.css`, `UX.bar` |
| Content entrance | `.ux-enter` (fade + rise). Admin views replay it on every route change; the dashboard fades in after sign-in. | `UX.enter(el)` |
| Scroll reveal | `.reveal` elements fade and rise once when they enter the viewport (IntersectionObserver, 8 % threshold), staggered by sibling position (`--i`, 70 ms steps, capped). They never replay. Without JavaScript, or with reduced motion, content is visible immediately. Used on the public pages (sections, cards, statistics, footer, report cards) and dashboard cards. | `UX.reveal(root, extraSelector)` |
| Hover | Cards lift 3 px with a soft border highlight and icon nudge; nav links get an animated underline; buttons nudge a trailing icon. Hover effects are limited to `(hover:hover)` devices, so touch screens get no hover-only behaviour. | `site.css`, `admin.css` |
| Buttons | Idle, hover, active (pressed scale .97), loading (spinner, `aria-busy`, disabled, **size locked** so the label change never resizes it), success (green ring + pulse), error (red ring + nudge), disabled. Duplicate clicks are ignored while loading. | `UX.busy`, `UX.run`, `UX.flash` |
| Modals and drawers | `<dialog>` open/close transitions with `@starting-style` and `allow-discrete`; drawers slide in from the right. The dashboard keeps a closed dialog for 280 ms so its exit animation can play, then removes it. | `ux.css`, `admin.js dlg()` |
| Navigation drawers | Public mobile menu and admin sidebar slide in over a dimmed scrim, lock background scrolling (`UX.lockScroll`), and close on outside tap, link tap or Escape. | `site.js setNav`, `admin.js openSide/closeSide` |
| Dropdowns | Account menu pops in (scale + fade from its corner). | `admin.css` |
| Dashboard | KPI cards pop in with stagger, table rows fade in (first rows staggered), chart bars grow from the axis, line charts draw, the active sidebar item shows an animated indicator. | `admin.css`, `admin.js chart()` |
| Admin Login | Page and card entrance, staggered feature list, two-step progress bar, input focus rings, loading button, shake on error, green success state before the dashboard fades in. | `admin.html`, `admin.css`, `admin.js` |
| Report Portal | Sections fade in, inputs animate focus, upload rows pop in with live progress, success box pops in, errors fade in. | `site.css`, `portal.js` |
| Public Reports | Report cards reveal with stagger, photos fade in when loaded (placeholder shimmer before), the lightbox fades/scales in and out, the search field shows a spinner while results load. | `reports.js`, `site.css` |
| AI Support | Launcher icon morphs and shows a loading ring while the widget boots; the panel scales in from the launcher; messages slide in; typing dots; skeleton while a conversation loads. | `site.css`, `site.js` |
| Backgrounds | Low-intensity ambient glow drifting over 16–22 s behind the hero and login; disabled on screens under 640 px and under reduced motion. | `site.css`, `admin.css` |

## Reduced motion

With `prefers-reduced-motion: reduce`:
* page transitions, entrances, reveals, staggers, hover lifts, press scaling, drawer/modal transitions, chart
  growth, ambient backgrounds and message entrances are disabled;
* all revealed content is visible immediately;
* spinners keep turning slowly (2.4 s) so loading remains understandable; progress bars still fill;
* navigation, focus outlines and every feedback state stay available.

The V7 browser suite verifies that no looping animation runs and every `.reveal` is fully visible under reduced motion.

## Rules for new code

1. Use the tokens and the existing keyframes (`ux-enter`, `ux-fade`, `ux-pop`, `ux-row`, `ux-grow`, `ux-draw`).
2. Animate `transform` and `opacity`; never animate layout properties for movement.
3. Async buttons go through `UX.busy` / `UX.run` / `A.run(…, btn)`; never show success before the server confirms.
4. Add a matching rule to the reduced-motion block for every new animation.
5. Do not add an animation library.
