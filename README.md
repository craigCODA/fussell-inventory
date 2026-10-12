# Fussell Inventory

Appliance intake and inventory for iPhone, Android and desktop browsers. Start with [START-HERE.md](START-HERE.md) for deployment to `inventory.craigcoda.fyi`.

## Features

- Appliance and identification-tag photos, reviewed and rotated into the actual saved pixels.
- Locally executed Tesseract OCR, with independent spoken/typed identifiers and exact comparison.
- Your uploaded voice instructions, browser/keyboard dictation and spoken readback.
- Store location choices for Ball · K&T Appliances and Alexandria · Fussell Appliances, with free entry for other locations.
- Offline intake: multiple saved items and their photos stay in IndexedDB, with a persistent upload queue, local inventory view and visible sync status.
- An offline app shell after the initial online load, plus shared D1 inventory and private R2 photo/audio storage.
- Optimistic revisions, duplicate brand/serial protection, retry-safe saves and explicit ready status.
- Selected-record CSV exports work offline. KORONA product CSV includes prices; stock receipt remains a separate operation.
- Export selection follows the current view; archived or filtered-out entries stop counting as selected.
- Confirmed permanent deletion from an entry's Review step while online and synced, including unused attached photos. Archived entries can be found through the status filter. A deletion audit entry is retained.

## Architecture

React + Vite supplies the client. A Cloudflare Worker validates Cloudflare Access JWTs before handling every `/api/` route. D1 and R2 are the Worker's database and file bindings. Source lives in this repository; user uploads and actual inventory do not.

The client assets contain code and the OCR language model only. They may be publicly retrievable independently of the Access-protected domain. All server access to business records, photo uploads, prompt uploads and exports is authenticated at the Worker. Previously downloaded records and locally captured photos can be viewed and exported offline from the same browser. Access policy is shared-workspace authorization: everyone admitted by its email allowlist can read and edit inventory. Configure that policy for the intended staff.

The client writes an item and its photo blobs to IndexedDB before reporting a local save. A versioned queue uploads photos, checkpoints returned photo keys, then saves the record with its stable UUID and server revision. Successful uploads retain the local photos. Retries use the server's idempotent save behavior; a server response cannot replace a newer local edit. Web Locks coordinate tabs where supported. Conflicting server edits stay local with a review message instead of overwriting another user's changes.

The service worker caches the app shell and successfully retrieved images/audio, not inventory API responses, writes or sign-in pages. A fresh server snapshot updates only synced local entries; queued edits survive refreshes and authentication failures. KORONA is not needed for local saves, server sync or CSV exports.

The original ChatGPT-hosted version is a separate deployment. This project has no Sites deployment ID, ChatGPT authentication, OpenAI API key or paid generative AI dependency. OCR uses a recognition model locally; browser dictation may use Apple/Google services.

## Commands

```sh
npm ci
npm test
npm run build
npm run check:deploy
```

Browser regressions exercise phone and desktop layouts against the real API handler with temporary SQLite and file storage:

```sh
npx playwright install chromium --only-shell
npm run test:browser
```

`npm run check:deploy` bundles the Worker without publishing. Set the real Database ID and create the R2 bucket before `npm run deploy`. Use `npm run db:migrate` to apply migrations to the configured remote D1 database.

Node 22.13+ is required. `npm run dev` serves the interface only; authenticated server operations need the configured Worker and Access domain. No development authentication bypass is included.

## Boundaries

Open the app online once and wait for **Offline access ready** before relying on offline reopening. Saved items, including ready records, can then be created and edited offline. One unfinished intake draft is also kept per browser. Locally captured photos stay with each saved item; photos captured on other devices are available offline only after this browser has loaded them.

Sync runs when the app is open, on reconnect/reopen and periodically while visible. Closing the browser does not guarantee background uploads. Expired sign-in leaves items queued until the user signs in again. Validation or revision conflicts remain visible for review; automatic retries do not overwrite conflicting records. Permanent deletion currently requires the item to be synced and the device online.

Browser storage is finite. The app requests persistent storage where supported, but private browsing, clearing site data, device loss or browser eviction can remove unsynced work. A failed local write never reports a local save; when online, the existing direct server save is used as a fallback. First use of OCR downloads its files. Camera and dictation depend on device/browser support; typing and photo selection remain available.

CSV generation works from the local records. Photo links for newly captured images become available after upload; the CSV does not embed photo files. A synced copy in Cloudflare protects against loss of this device's browser data.

Google Drive sync and direct KORONA synchronization are not connected. General CSV photo links require app access. KORONA categories, price-group mapping and receiving workflow must be confirmed for the store. Data entered in the earlier hosted test is not automatically migrated.

The OCR assets under `public/ocr` include their licenses. The embedded `.wasm.js` distributions contain their own WebAssembly; duplicate standalone binaries are omitted.
