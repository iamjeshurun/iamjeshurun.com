# iamjeshurun.com

The portfolio of Jeshurun: a static Astro site deployed to GitHub Pages and served at <https://iamjeshurun.com>.

- **Stack:** Astro 7 (static output), plain TypeScript for motion, no UI framework, no animation library, no trackers.
- **Pages:** `/`, `/work/<slug>/` (one per project), `404.html`, plus `sitemap-index.xml`, `robots.txt` and `resume.pdf`.
- **Independence:** the site never calls the project demos or their Render APIs; it only links to them.

## Local development

Requires Node 22+ (CI uses 24). Google Chrome is needed only for the check and OG scripts.

```bash
npm ci
npm run dev        # http://localhost:4321 with hot reload
npm run build      # writes dist/
npm run preview    # serves dist/ at http://localhost:4321
npm run check      # end-to-end checks against the running preview (add -- --external to test outbound links)
node scripts/interaction-check.mjs   # homepage interaction tests in a real Chrome window (see below)
node scripts/spatial-check.mjs       # spatial view tests (add --browser=webkit; see Spatial view)
node scripts/wheel-traces.mjs        # wheel-gesture classifier against modelled traces (no browser)
```

`npm run check` builds nothing itself. Run `npm run build` and `npm run preview` first. It checks routes, the 404 page, the résumé file, metadata, the public-name and no-email/no-phone rules, heading order, alt text, overflow at 390 px and 1440 px (also at 200% text), auto-advance, pause, keyboard order, reduced motion, and the preview → case-study view transition.

## Updating content

| What | Where |
| --- | --- |
| Project copy, links, decisions, evidence, limits | `src/content/work/<slug>.yaml` (validated by `src/content.config.ts`; the build fails if a field is missing) |
| Screenshots | `src/assets/shots/<key>-0/1/2.webp` (2400×1500, 16:10) for the opening previews and case studies, `<key>-phone.webp` (1000 px wide) for phone cards, and one cropped visual per project for Selected Work (`workShot` in the YAML, with its alt text and caption; `wide: true` gives it the full panel width). Astro generates the AVIF/WebP sizes. |
| Homepage and project order | `src/components/Home.astro` (opening, picker, Selected Work) rendered by `src/pages/index.astro`. The `order` field in each YAML sets the sequence everywhere (01 InsightPulse, 02 Tracker, 03 Campus Health, 04 Risk); order 1 opens selected. Slugs and case-study URLs don't depend on order. |
| About, AI workflow note, experience | `src/components/About.astro` |
| Contact links | `src/components/Contact.astro`, `src/components/Footer.astro`, and `sameAs` in `src/pages/index.astro` |
| Résumé | Replace `public/resume.pdf` with the new PDF and rebuild. The site serves it unchanged. |
| Social images | `npm run og` re-renders `public/og/*.png` from the YAML and screenshots. |

Each project has a `headline` (used in the picker, phone cards and social images), a short `blurb`, and a `featuredDecision` (index into `decisions`) shown in Selected Work. Captions under the work visuals carry the data qualifications (live sample, fictional, synthetic, precomputed).

Writing rules the copy follows: the public name is "Jeshurun" everywhere except inside the PDF; every number appears with its context; the boundary between demo data and real data is stated for every project; there's no phone number or email address.

### Refreshing screenshots

Capture public demos only (never the local tracker or private data) at 1440×900, device scale 2, after any count-up animation has settled. Save them as WebP at 2400 px wide, quality 90. Phone cards come from a 390×844 capture at scale 3, cropped to the top 2100 px and resized to 1000 px wide.

## Homepage composition and motion

The opening follows Option B: an oversized “Jeshurun” masthead, the introduction on the left, a numbered project list in the middle, and layered previews on the right. Below 1200 px the introduction becomes a row above the list and previews. Below 900 px the project area becomes a row of swipeable cards with number buttons; the desktop columns aren't squeezed.

**How selection works.** One render function (the inline script in `Home.astro`) flips attributes: `aria-selected` on the list, `data-pos` on each preview set, `is-active`/`inert` on each description, and `aria-pressed` on the phone buttons. Every visual change is a CSS transition on those attributes. Rapid or interrupted changes therefore *retarget* rather than queue timers, and the list, foreground preview, description and links can't disagree. The same script restores a returning visitor's choice before first render.

| Moment | Behaviour |
| --- | --- |
| Opening | Masthead letters rise (34 ms apart), list rows slide in, previews rise into their tilt. Done in about 1.2 s and never blocks input. Skipped when returning from a case study. |
| Choosing a project | Click, tap, arrow keys/Home/End, or a horizontal swipe on the previews. Hover only highlights; it never changes the selection, so the list never moves under the pointer. |
| Project change | The outgoing set clears in 150 ms and tilts away; the incoming set rises in 760 ms. At most two sets are ever visible. |
| Depth | One stable, fully clickable foreground; two supporting screens behind it drift a few pixels (9 s / 12 s loops); the scene leans ≤2° toward the pointer. Only the foreground link takes clicks. |
| Auto-advance | 7 s per project, only until the visitor makes a choice (then off for the session). It holds while the pointer, focus or a finger is in the project area. It pauses offscreen, in hidden tabs, and with **Pause**; resuming continues the countdown rather than restarting it. Not used on phones. |
| Preview → case study | Cross-document View Transitions: the selected foreground becomes the case-study header (760 ms). **All work** and the browser Back button both return with the same project selected and the same scroll position, and the frame travels back into place. |
| Selected Work | Sticky project index beside one panel per project: headline, blurb, one engineering decision, links, and a single purposeful visual with its caption. Visuals alternate sides; wide visuals (charts) span the panel. Each visual arrives tilted and flattens as it reaches reading position (scroll-linked, never scroll-jacked). |
| Reduced motion | No travel, drift, parallax, auto-advance or page transitions. Selection is immediate. Content and controls are identical. |

Keep all page JavaScript in the single entry `src/scripts/site.ts`. A second entry makes Vite split `core.ts` into a shared chunk, and that chained import delayed first render enough for Chrome to skip the cross-page transition intermittently.

### Interaction tests

`scripts/interaction-check.mjs` runs 34 checks in a visible Chrome window, because timers and transitions behave differently in hidden or headless pages. It checks:

- agreement on every animation frame during rapid and reversing clicks
- clicks during a transition
- a hover sweep
- every auto-advance rule (including pause and resume timing)
- the return journey by Back and by **All work**
- resizing across the breakpoint
- keyboard-only use
- phone swipe and tap (touch events via the Chrome DevTools Protocol)
- tablet swipe
- reduced motion

## Spatial view

An optional way to explore the same four projects, launched from **Explore in spatial view ↗** next to the “Selected work” label on the homepage. It opens as a dialog (`src/components/Spatial.astro`) over the homepage; the controller is loaded on demand as its own chunk, and the launcher appears only once it is ready. Closing returns the homepage picker to whichever project was active in the spatial view, restores scroll position, and returns focus to the launcher. Opening a case study from the spatial view and pressing Back reopens it.

**Interaction model** (`src/scripts/spatial.ts`): one controller owns the active project, the pointer, the camera, entry/exit and opening. Its states are `closed → idle ⇄ pressed → dragging → settling → idle`, plus `opening`.

- **Clicking:** clicking the front card opens its case study; clicking a background card brings it to the front. Each card shows which it will do (“Open case study →” / “Bring to front”).
- **Dragging:** a drag starts only after 6 px of movement (10 px for touch), never opens anything, and glides to the nearest project on release. Drags are rubber-banded at the edges.
- **Wheel and trackpad:** one project per intentional swipe, with no time-based lock (`src/scripts/wheel-gestures.ts`). A new gesture starts after a 140 ms pause, on a firm reversal, or when deltas rise again during a previous swipe's momentum (fingers re-engaging). The target moves immediately and a moving camera retargets smoothly. A swipe's own momentum tail is ignored, so it never skips projects. At the first or last project, a swipe gives a short bounce rather than silence.
- **Keyboard:** arrow keys, Home and End. The project bar, Open case study, Recenter and Exit sit outside the moving scene.
- **Camera:** at rest, CSS positions the world (active unit × card size), so the composition needs no script and survives resizing. While moving, the controller writes one transform. Every loop and timer carries a generation token, so obsolete callbacks never write. All listeners are tied to one `AbortController` per session.
- **Not on phones:** below 900 px the launcher is hidden and B's cards remain.
- **Fallbacks:** reduced motion makes changes instant, and the launcher only appears once the controller is ready.

**Input log:** open `/?debug=input` and launch the spatial view to see every wheel, key and pointer decision on screen (accepted, ignored and why, or boundary). **Copy log** exports it; save the export as `scripts/wheel-recorded/<name>.json` to replay a physical-trackpad session through both the old and new logic with `node scripts/wheel-traces.mjs`. `node scripts/wheel-browser-check.mjs --browser=chromium|webkit|safari` replays modelled trackpad streams in a real browser.

**Tests:** `node scripts/spatial-check.mjs` (Chrome, 59 checks) and `node scripts/spatial-check.mjs --browser=webkit` (Playwright WebKit, 54 checks; touch-specific checks are Chrome-only). WebKit needs a one-time `npx playwright@1.55.0 install webkit`. Real Safari: `node scripts/safari-check.mjs` (34 checks via `safaridriver`). It needs Safari ▸ Settings ▸ Advanced ▸ “Show features for web developers”, then Develop ▸ “Allow Remote Automation”. Safari's WebDriver has no touch input or reduced-motion emulation, and its wheel action can't model a gesture, so the wheel check dispatches real `WheelEvent`s in Safari instead.

## Deployment

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on pushes to `main`. `public/CNAME` sets the custom domain for **this repository only**.

The site is deliberately a *project* site, not the account-level `iamjeshurun.github.io` site. Attaching the domain to an account-level site would move every project demo to `iamjeshurun.com/<repo>/`. That would break the Portfolio Risk API's CORS allow-list (`https://iamjeshurun.github.io`) and reset per-origin browser storage for those demos.

DNS (Cloudflare, "DNS only" until GitHub issues the certificate):

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 |
| AAAA | `@` | 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153 |
| CNAME | `www` | `iamjeshurun.github.io` |

Verify `iamjeshurun.com` under GitHub → Settings → Pages → Verified domains before adding the records, then enable **Enforce HTTPS** once the certificate is issued.

## Fonts and licences

Geist and Geist Mono are SIL Open Font License 1.1. They're self-hosted from `@fontsource-variable/*`; no font CDN is used.
