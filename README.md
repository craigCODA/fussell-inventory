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
- Recieving holds incoming appliances; Inventory holds exported appliances. Export dates persist locally and sync between devices without changing appliance status or store location.
- One export action prepares two separate CSV downloads: complete inventory for all selected records and KORONA products with prices for eligible ready records. New exports are authorized desktop operations; copies of already processed inventory remain available offline, with individual download links for browsers that restrict multiple downloads. Stock receipt remains a separate operation.
- Export selection follows the current view; archived or filtered-out entries stop counting as selected.
- Confirmed permanent deletion of unprocessed Recieving entries while online and synced, including unused attached photos. Processed Inventory has no Delete option and the API rejects deletion even after archiving or export reversal. Archived entries remain available through the status filter. A deletion audit entry is retained.

## Architecture

React + Vite supplies the client. A Cloudflare Worker validates Cloudflare Access JWTs before handling every `/api/` route. D1 and R2 are the Worker's database and file bindings. Source lives in this repository; user uploads and actual inventory do not.

The client assets contain code and the OCR language model only. They may be publicly retrievable independently of the Access-protected domain. All server access to business records, photo uploads, prompt uploads and exports is authenticated at the Worker. Previously downloaded records and locally captured photos can be viewed offline from the same browser. The designated exporter can download copies of already processed inventory offline from the desktop. Access policy is shared-workspace authorization: everyone admitted by its email allowlist can read and edit inventory. Configure that policy for the intended staff.

The client writes an item and its photo blobs to IndexedDB before reporting a local save. A versioned queue uploads photos, checkpoints returned photo keys, then saves the record with its stable UUID and server revision. Successful uploads retain the local photos. Retries use the server's idempotent save behavior; a server response cannot replace a newer local edit. Web Locks coordinate tabs where supported. Conflicting server edits stay local with a review message instead of overwriting another user's changes.

The service worker caches the app shell and successfully retrieved images/audio, not inventory API responses, writes or sign-in pages. A fresh server snapshot updates synced local entries and authoritative workflow fields on pending entries; queued appliance edits survive refreshes and authentication failures. KORONA is not needed for local saves, server sync or CSV exports.

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

Sync runs when the app is open, on reconnect/reopen and periodically while visible. Closing the browser does not guarantee background uploads. Expired sign-in leaves items queued until the user signs in again. Validation or revision conflicts remain visible for review. An offline save can cross revisions containing only export/reversal audit events; ordinary concurrent edits still conflict. Permanent deletion requires an unprocessed Recieving item to be synced and the device online. Use Archive for processed Inventory.

Browser storage is finite. The app requests persistent storage where supported, but private browsing, clearing site data, device loss or browser eviction can remove unsynced work. A failed local write never reports a local save; when online, the existing direct server save is used as a fallback. First use of OCR downloads its files. Camera and dictation depend on device/browser support; typing and photo selection remain available.

CSV generation works from the local records. Photo links for newly captured images become available after upload; the CSV does not embed photo files. A synced copy in Cloudflare protects against loss of this device's browser data.

The desktop sends an idempotent export request to the server, which assigns permanent numbers, records the batch snapshots and moves included records to Inventory in one database transaction. The browser then prepares and requests CSV downloads, keeping individual links available. The batch remains downloadable from history after a lost response or device cache failure. Browsers cannot confirm a file was kept or imported into KORONA. Only included records are marked; an inventory-only export can include drafts with a known type, fuel where relevant, receiving date and stores. A batch is limited to 100 records; unusually large text content requires smaller groups to stay within D1’s row limit. Legacy exported records keep their IDs; legacy unexported records receive new numbers when first processed through this workflow.

Export history supports reversal of selected items or the remaining items in a batch. Reversal is atomic, requires a reason, and returns processing state to Recieving across devices after sync. Photos, status, location and assigned IDs stay unchanged. Reversed IDs remain reserved and protected from deletion. Old offline data cannot restore canceled export markers. History records the operator, timestamp, items, stores, override reason and reversal reason. The app prevents downloading a batch with reversed items from its online history; files already downloaded cannot be recalled. An imported KORONA CSV needs a separate correction in KORONA. No reversal sends any KORONA operation.

Offline work continues for receiving and editing. First exports and reversals require the shared server. The authorized desktop can download local copies of currently processed records while offline, using its last cached state; those copies create no processing event. Changes on another device become known after reconnecting. The legacy GET export route is authorized, read-only, and limited to already processed items.

Google Drive sync and direct KORONA synchronization are not connected. General CSV photo links require app access. KORONA categories, price-group mapping and receiving workflow must be confirmed for the store. Data entered in the earlier hosted test is not automatically migrated.

## Desktop export setup

Set **`EXPORTER_EMAIL`** to the exact Cloudflare Access sign-in email of the single designated exporter in the Worker’s **Settings → Variables and Secrets**. The account must also be admitted by the existing Access policy. `keep_vars: true` preserves this dashboard-managed value on deploys. No default operator is assumed: an unset value disables server exports and reversals while receiving and sync continue.

The server compares the verified JWT email with this setting for every export/history/reversal request. It does not trust an email sent by the browser. Staff can still receive, view and edit inventory. Use individual sign-in emails for staff; a shared login also shares its permission. Desktop controls appear at a width of at least 1024 CSS pixels with a fine pointer. That is a workspace presentation rule; account authorization is the security boundary, not a claim of physical-device attestation. Phones in normal mobile layouts have no export controls.

Mixed current stores pause export and require an explicit reason to override. The server independently checks every selected record, so bypassing the warning in the interface cannot bypass the rule. Unknown stores must be corrected first.

## Product numbers

`FA-DEBA20261012001` has exactly one dash after FA. It means electric dryer, received at Ball on October 12, 2026, first exported item of that type/receiving store/date group. The three-digit suffix is a minimum width and expands beyond 999. Separate counts are maintained for each type, receiving store and receiving date. Dates use America/Chicago and are captured locally during intake. The number is assigned at first export and stays fixed through corrections, transfers, reversals and re-exports. The current store is separate from the receiving store. An internal full UUID identifies the record throughout; pending items use a full-UUID temporary ID and display “Pending export”.

| Code | Appliance |
|---|---|
| DW | Dishwasher |
| WM | Washer |
| DE / DG | Electric / gas dryer |
| OE / OG | Electric / gas oven |
| RE / RG | Electric / gas range |
| RF | Refrigerator/freezer |
| DF | Deep freezer |
| MW | Microwave |
| OT | Other |

Store codes are BA for Ball and AL for Alexandria. Electric/gas choices are explicit for dryers, ovens and ranges. Receiving store and date become fixed when the permanent number is assigned.

Daily counters, immutable export snapshots and reversal events are stored in reserved `settings` key namespaces (`inventory-counter:`, `inventory-export:`, `inventory-reversal:`). They use the existing D1 schema; **no additional database migration is needed for this release**. The prompt API only reads known recording keys. Every batch validates record revisions inside the same transaction as counters, record changes, audit entries and history. Failed transactions consume no numbers. Completed exports retain their numbers even if downloads fail or the batch is reversed; consequently a later file can show gaps, and numbering is not a count of currently active stock.

## Deletion boundary

`POST /api/records/delete` requires `target: "app"`, the record ID and its current revision. A KORONA, unknown or omitted target receives HTTP 403 before data changes. Any `exportedAt`, `numberAssignedAt` or `processedOnce` marker receives HTTP 409 before data changes, including when the record is archived. Older open clients without the explicit target must refresh before deleting an unprocessed entry. The client retains its local record and unfinished draft when deletion is rejected or the response does not explicitly confirm `deleted: true`.

Deletion makes no KORONA requests. The app-only deletion audit event is never an outbound KORONA operation. For any future connector, local deletion must be classified as **not applicable to KORONA synchronization**. Missing app records must never trigger remote deletion, deactivation, archiving, or stock adjustments. The connector must enforce this at its request boundary, including destructive operations encoded in POST or batch requests. Product creation and any approved updates need their own explicit operations. Future KORONA-linked records must receive the same deletion protection as processed Inventory before live synchronization is enabled.

Regression tests verify protected requests leave database rows, revisions, audit history and photos unchanged, that app-only deletion makes no outbound HTTP calls, and that rejection preserves local records and draft edits. These rules do not provide Trash or independent backups for unprocessed entries; their confirmed app-only deletion remains permanent.

The OCR assets under `public/ocr` include their licenses. The embedded `.wasm.js` distributions contain their own WebAssembly; duplicate standalone binaries are omitted.

Database limits and transaction semantics: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
