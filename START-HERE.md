# Put Fussell Inventory on inventory.craigcoda.fyi

Repository: https://github.com/craigCODA/fussell-inventory

This package is the standalone Cloudflare version. Source code is stored on GitHub; live records and uploaded files are stored in your Cloudflare account. It uses email sign-in through Cloudflare Access. Your ChatGPT account is not used for app access.

## 1. Upload the code

1. Extract this ZIP.
2. Open your GitHub repository. Choose **uploading an existing file** (or **Add file → Upload files**).
3. Upload the contents of the extracted folder. `package.json`, `wrangler.jsonc` and `index.html` must appear at the repository root, alongside `app`, `lib`, `worker`, `public`, `migrations` and `tests`.
4. Commit the uploaded files to `main`.

The ZIP itself is a delivery container. Upload the extracted files so Cloudflare can build them.

GitHub reported this repository as public when it was checked. If you intended private source, use **Settings → General → Danger Zone → Change repository visibility**. Live inventory is separate from source visibility and requires sign-in either way.

## 2. Create the inventory database

In your Cloudflare dashboard, open **Storage & databases → D1** and create:

`fussell-inventory-db`

Copy its **Database ID**. In GitHub, edit `wrangler.jsonc` and replace the value `REPLACE_WITH_D1_DATABASE_ID` with that ID. Commit the edit.

Open the database's **Console** and run the SQL from `migrations/0001_inventory.sql` once against this new empty database. This creates the four tables and unique indexes. Alternatively, from a signed-in terminal in this project, run:

```sh
npx wrangler login
npm run db:migrate
```

Use one initialization method. The initial SQL is safe to repeat, so Wrangler can adopt it later if you started in the dashboard. Later schema changes should use numbered migrations through Wrangler. This creates a fresh database; any records entered in the earlier ChatGPT-hosted test app are not copied automatically.

## 3. Create photo storage

Open **Storage & databases → R2** and create a bucket named:

`fussell-inventory-photos`

Keep public bucket access disabled. The app serves photos and audio through its authenticated API. If Cloudflare asks to activate R2 or select a plan, review that account step yourself; no plan or billing option has been selected by this project.

## 4. Connect the GitHub repository

Open **Workers & Pages → Create application → Import a repository**. Choose `craigCODA/fussell-inventory`.

| Setting | Value |
| --- | --- |
| Worker name | `fussell-inventory` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Node version | 22.13 or newer (Node 24 works) |

Connect the GitHub installation to this repository if Cloudflare asks. The checked-in package lock provides reproducible installation. This is a **Worker** with static assets; do not configure it as a Pages-only static site.

If the build reports missing database or bucket resources, check the names and Database ID in `wrangler.jsonc` against steps 2–3.

The first deployment can show a configuration notice until Access is set up below. Inventory endpoints remain locked during setup.

## 5. Add your domain

In the Worker's **Settings → Domains & Routes**, add a **Custom Domain**:

`inventory.craigcoda.fyi`

The domain must be active in the same Cloudflare account. Cloudflare configures the subdomain and certificate. Your main CraigCODA.fyi website stays at its current address.

## 6. Set up email access

In Cloudflare **Zero Trust / Cloudflare One**, create a **self-hosted Access application** for the full hostname `inventory.craigcoda.fyi`. Leave its path unrestricted so the entire app is covered.

- Application name: `Fussell Inventory`
- Login method: **One-time PIN** (email code)
- Policy action: **Allow**
- Include rule: **Emails**, listing your email and her email explicitly
- Session duration: choose what suits your shift; 24 hours is a starting point

Use the specific email allowlist. Selecting One-time PIN alone as an Include rule would authorize any email address.

Copy your **team domain** and the application's **Application Audience (AUD) Tag**. Add these as Worker runtime variables under **Settings → Variables and Secrets**:

| Variable | Value |
| --- | --- |
| `TEAM_DOMAIN` | `https://YOUR-TEAM.cloudflareaccess.com` |
| `POLICY_AUD` | The full Application Audience tag |

Save and deploy the runtime settings. These identify the Access application; they are not passwords. `keep_vars` in the config preserves dashboard variables on later code deployments.

The app verifies token signature, expiration, issuer and audience. An unprotected workers.dev or preview URL cannot access inventory data without a valid token for this application. Use the custom domain for everyday work.

## 7. Test one real appliance

1. Open `https://inventory.craigcoda.fyi` and sign in using your allowed email.
2. Photograph the appliance and label. Rotate the label and confirm **Use photo**.
3. Run **Read label**, then independently speak or type the identifiers. Check zero/O and all model suffixes.
4. Save, reopen the record and verify both images. Check the same record from a desktop.
5. Open the same address using her email and confirm access.
6. Upload your voice clips through **Spoken instructions**.
7. Export one ready record and verify the KORONA field mapping before importing a batch.

## What is already checked

The shared inventory logic has automated coverage for identifiers, pricing, CSV, stored records, duplicate identifiers, revisions and upload retries. The standalone version adds signed-token authentication tests and a Cloudflare deployment dry run. Physical iPhone/Android camera, microphone and final account integration checks still require the devices and your Cloudflare account.

## Reference documentation

- Worker Git build configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Worker custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Access applications: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- Email PIN login: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- Access token validation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
