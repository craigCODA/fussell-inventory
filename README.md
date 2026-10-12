# Fussell Inventory

Appliance intake and inventory for iPhone, Android and desktop browsers. Start with [START-HERE.md](START-HERE.md) for deployment to `inventory.craigcoda.fyi`.

## Features

- Appliance and identification-tag photos, reviewed and rotated into the actual saved pixels.
- Locally executed Tesseract OCR, with independent spoken/typed identifiers and exact comparison.
- Your uploaded voice instructions, browser/keyboard dictation and spoken readback.
- Local draft recovery plus shared D1 inventory and private R2 photo/audio storage.
- Optimistic revisions, duplicate brand/serial protection, retry-safe saves and explicit ready status.
- Selected-record CSV exports. KORONA product CSV includes prices; stock receipt remains a separate operation.

## Architecture

React + Vite supplies the client. A Cloudflare Worker validates Cloudflare Access JWTs before handling every `/api/` route. D1 and R2 are the Worker's database and file bindings. Source lives in this repository; user uploads and actual inventory do not.

The client assets contain code and the OCR language model only. They may be publicly retrievable independently of the Access-protected domain. All business records, photo uploads, prompt uploads and exports are authenticated at the Worker. Access policy is shared-workspace authorization: everyone admitted by its email allowlist can read and edit inventory. Configure that policy for the intended staff.

The original ChatGPT-hosted version is a separate deployment. This project has no Sites deployment ID, ChatGPT authentication, OpenAI API key or paid generative AI dependency. OCR uses a recognition model locally; browser dictation may use Apple/Google services.

## Commands

```sh
npm ci
npm test
npm run build
npm run check:deploy
```

`npm run check:deploy` bundles the Worker without publishing. Set the real Database ID and create the R2 bucket before `npm run deploy`. Use `npm run db:migrate` to apply migrations to the configured remote D1 database.

Node 22.13+ is required. `npm run dev` serves the interface only; authenticated server operations need the configured Worker and Access domain. No development authentication bypass is included.

## Boundaries

One unfinished local draft is kept per browser, including pending photos. Online saves require a connection, and first use of OCR downloads its files. Local draft storage is best-effort; failure of local storage does not block a successful cloud save.

Google Drive sync and direct KORONA synchronization are not connected. General CSV photo links require app access. KORONA categories, price-group mapping and receiving workflow must be confirmed for the store. Data entered in the earlier hosted test is not automatically migrated.

The OCR assets under `public/ocr` include their licenses. The embedded `.wasm.js` distributions contain their own WebAssembly; duplicate standalone binaries are omitted.
