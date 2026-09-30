# Frontend verification

Use Node.js 22.15 or newer for the tests:

```sh
npm test
npm run build
```

The test loader uses esbuild with `node:test` so both `.mjs` and `.ts` tests, including extensionless TypeScript and directory index imports, run through one entry point. `i18n.test.ts` checks catalog keys and interpolation parity, partial translations, locale aliases, formatting and a third-language registration.

The optional browser check mounts the real watchlist view and chat hooks, in React development StrictMode. It checks dragging only changes an edit draft, closing edit mode saves exactly once, and one chat submission produces one persisted assistant reply. A temporary server supplies every API response from memory, and external browser requests are blocked. It never uses a real account or backend.

```sh
# Requires Playwright and a Chromium browser in the test environment.
npm run test:browser
```

When using an existing Playwright installation or Chrome executable, set `PLAYWRIGHT_MODULE_PATH` to its absolute `index.mjs` path and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the browser executable. `STRICT_MODE_SCREENSHOT` optionally saves the final page (or a failure screenshot). The test needs permission to listen on `127.0.0.1` and launch the isolated headless browser.

The company-list regression uses the real charts and built CSS. It verifies group tabs (keyboard navigation, empty groups and mobile overflow), combined local filters, edit-only drag/sort controls, save on edit close, failure retry with the draft retained, order/preference persistence and preservation of hidden slots when sorting a group. It also covers missing-quote ordering, group creation/rename/deletion and membership, saved indicator preferences, actual Canvas painting under StrictMode, and capital-flow layout at 844×390, 667×375, and 568×320. Cost-distribution checks cover saved 60/120/250-bar samples, cost ranges, following the K-line price range, keyboard/touch inspection, dark mode and gain/loss colors, flat/zero-volume samples, and landscape/portrait layouts. It also checks empty/error states and rotation without list/chart overlap. All browser requests are intercepted with fixtures; no backend or live account is used.

```sh
npm run build
npm run test:browser:watchlist
```

The same Playwright environment variables apply. Screenshots are saved as `/tmp/stocks-watchlist-desktop.png`, `/tmp/stocks-watchlist-editing.png`, `/tmp/stocks-watchlist-editing-mobile.png`, `/tmp/stocks-chips-dark.png`, `/tmp/stocks-chips-landscape.png`, `/tmp/stocks-chips-portrait.png`, `/tmp/stocks-capital-landscape.png`, `/tmp/stocks-watchlist-portrait.png`, or `/tmp/stocks-watchlist-failure.png` on failure. Mobile portrait screenshots use the viewport to avoid changing orientation media queries during a full-page capture.

The built-workspace smoke test checks the company chart, holdings, news and financials, plus navigation, knowledge, scheduler, settings and general chat. It verifies all six theme colors in light/dark modes, primary text contrast, keyboard selection, reload persistence, mobile swatch layout and invalid-preference recovery. Market and indicator colors must remain independent of the theme accent. It also asserts that no removed research, labs, alerts or Guardian endpoints are requested, including with old browser preferences. It also checks language selection, account autosave, HTML `lang`/`dir` and reload persistence. API responses are entirely fixtures.

```sh
npm run build
npm run test:browser:workspace
```

The same Playwright environment variables apply. Screenshots are saved as `/tmp/stocks-company-after-removal.png`, `/tmp/stocks-theme-light.png`, `/tmp/stocks-theme-dark.png`, `/tmp/stocks-theme-mobile.png`, or `/tmp/stocks-workspace-removal-failure.png`.

The workspace check also verifies market configuration autosave, switching settings tabs and pages while a save is pending, persistence after reload, rendering more than eight dashboard indices, and success toasts for both automatic and explicit saves of market and general settings.

Mobile scroll regressions cover all settings tabs at 390×844, 320×568, 844×390 and 768×1024, actual vertical/horizontal touch gestures, and desktop pane scrolling. They also check password/task drawers in landscape, memory/knowledge/portfolio pages, and long MCP tool/skill preview dialogs in portrait, landscape and desktop viewports. Content reachability is checked without locator auto-scrolling, which can conceal `overflow: hidden` clipping. All data is supplied by fixtures. Screenshots include `/tmp/stocks-settings-scroll-mobile.png` and `/tmp/stocks-skill-scroll-{width}.png`.

Portfolio chart checks use saved closing snapshots from the API, retain history when current quotes are missing, and verify that page visits leave legacy browser snapshots untouched.
