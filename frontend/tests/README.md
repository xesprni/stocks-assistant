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
