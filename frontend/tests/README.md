# Frontend verification

Use Node.js 22.15 or newer for the tests:

```sh
npm test
npm run build
```

The test loader uses esbuild with `node:test` so both `.mjs` and `.ts` tests, including extensionless TypeScript imports, run through one entry point.

The optional browser check mounts the real watchlist and research document views, plus the chat hooks, in React development StrictMode. It checks one drag produces one reorder, old company responses cannot populate a new company, and one chat submission produces one persisted assistant reply. A temporary server supplies every API response from memory, and external browser requests are blocked. It never uses a real account or backend.

```sh
# Requires Playwright and a Chromium browser in the test environment.
npm run test:browser
```

When using an existing Playwright installation or Chrome executable, set `PLAYWRIGHT_MODULE_PATH` to its absolute `index.mjs` path and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the browser executable. `STRICT_MODE_SCREENSHOT` optionally saves the final page (or a failure screenshot). The test needs permission to listen on `127.0.0.1` and launch the isolated headless browser.

The company-list regression uses the real charts and built CSS. It verifies combined local filters, missing-quote ordering, group creation/rename/deletion and membership, saved indicator preferences, actual Canvas painting under StrictMode, and capital-flow layout at 844×390, 667×375, and 568×320. It also checks empty/error states and rotation back to portrait without list/chart overlap. All browser requests are intercepted with fixtures; no backend or live account is used.

```sh
npm run build
npm run test:browser:watchlist
```

The same Playwright environment variables apply. Screenshots are saved as `/tmp/stocks-watchlist-desktop.png`, `/tmp/stocks-capital-landscape.png`, `/tmp/stocks-watchlist-portrait.png`, or `/tmp/stocks-watchlist-failure.png` on failure.
