# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AIMERKA is a private, single-company ERP pilot for HAVANI Technologies México. It covers:
- orders, inventory and products;
- purchases backed by documents;
- expenses and credit schedules;
- pricing and marketplace commissions;
- settlement and bank reconciliation.

It runs as a Cloudflare Worker built with **vinext** (the Next.js App Router API on Vite). **D1** holds the state and **R2** holds uploaded files.

The OpenAI Sites tooling provides hosting, sign-in and publishing:
- `.openai/hosting.json` names the `DB` and `BUCKET` bindings.
- Local builds and servers never publish.
- The existing git history is automatic "Update Site source" snapshots made by that tooling.

UI text, error messages and most docs are in Spanish (es-MX). Keep user-facing strings in Spanish.

`README.md` still describes V28. Where it disagrees with the code (workspaces, seeds), trust the code and this file. Business rules for settlement and for document-backed purchases are in `docs/V43-reconciliation.md` and `docs/PURCHASES_AND_DOCUMENTS.md`.

## Commands

Requires Node ≥ 22.13.

```bash
npm run install:ci            # npm ci with the flags the Sites tooling expects (must run through npm)
node scripts/sync-client.mjs  # after editing a synced lib/ engine, lib/legacy-domain.cjs or public/erp/index.html
npm run dev                   # vinext dev server on port 5173
npm run build                 # vinext build into dist/; does NOT run sync-client
npm start                     # serve the built worker with wrangler, local D1 in .wrangler/state
npm run lint
npm run db:generate           # drizzle-kit migration from db/schema.ts; review it before applying
```

Tests use plain `node:test`:
- They import engines from `lib/` and load browser scripts through `node:vm`.
- They work on in-memory copies of `data/` and never touch D1.
- Only the `.mjs` engines can be tested this way. The `lib/*.ts` modules import `cloudflare:workers`, so they run only inside the worker.

```bash
node --test tests/*.test.mjs                                     # full suite, ~800 tests, runs in seconds
node --test tests/settlement-v43.test.mjs                        # one file
node --test --test-name-pattern="<regex>" tests/<file>.test.mjs  # one test
node check-domain.cjs                                            # 9 scenarios of the legacy v1 engine
node --check public/erp/<file>.js                                # syntax check (browser scripts are not bundled or type-checked)
```

Some checks are opt-in and run against a local server. They take the base URL as their first argument and refuse non-local hosts:
- `tests/api-persistence-smoke.mjs` writes and then restores a note in the local `v43` workspace.
- `tests/built-worker-*-smoke.mjs` need `AIMERKA_ISOLATED_FIXTURE=yes` and a disposable local D1.
- `scripts/qa-v43-local.mjs` and `scripts/qa-v43-recovery-local.mjs` are the V43 document and recovery lab checks.

To use `npm start` with a fresh local D1, apply the initial schema after a build:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB \
  --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_blushing_bloodscream.sql
```

Other scripts:
- `node scripts/vendor-document-readers.mjs` re-copies PDF.js and Tesseract into `public/erp/vendor/`.
- `scripts/generate-product-thumbnails.mjs` and `scripts/generate-original-image-index.mjs` use sharp to build the catalog thumbnails, previews and image index from `public/erp/catalog-v43/`.
- `scripts/import-v28.py` and `scripts/import-v43.py` regenerate the seeds from the source Excel workbooks. They need Python with openpyxl. They read the cached cell values and never run macros.
- The execution profile is `portable` unless `.sites-runtime/execution-profile.json` says `managed-linux`, which is the Codex sandbox. Under `managed-linux`, `dev` runs vite directly and `build` goes through `scripts/build-verified.sh`.

## Architecture

### Serving
- `GET /` is handled by `app/route.ts`. It returns `lib/shell.ts`, a generated string copy of `public/erp/index.html`.
- The ERP front end is static files in `public/erp/`, served at `/erp/*`. It is not React.
- The ERP doesn't use these starter-template leftovers: `app/layout.tsx`, `app/chatgpt-auth.ts`, `components/ui/` (vendored shadcn), `hooks/` and `examples/`.
- `worker/index.ts` wraps vinext's fetch handler. The API routes are in `app/api/*/route.ts`.

### Write path: `POST /api/action`
The request body is `{id, type, payload, workspace, revision}`. `app/api/action/route.ts` handles it in this order:

1. **Request checks.** The request must be same-origin JSON, and `id` must be 8–160 characters.
2. **Workspace.** `currentWorkspaceWrite` allows writes only to `v43`. `access.*` commands go to `/api/team` instead, and `practice.reset` is retired.
3. **Identity and permission.** Identity comes only from the Sites header `oai-authenticated-user-email`, read in `lib/access.ts`, never from the payload. `assertPermission` maps the command type to a permission with `permissionFor()` in `lib/access-control.mjs`. A type that matches no rule is rejected, so check that mapping whenever you add a command.
4. **Idempotency.** Repeating an `id` with the same input hash returns the stored result with `duplicate: true`. Reusing an `id` with different input returns 409.
5. **Optimistic concurrency.** A stale `revision` returns 409 together with the current state.
6. **Apply.** Uploads referenced by the command are verified in R2 (`verifyDocuments`). Then `applyCommand(next, command, context)` in `lib/commands.mjs` mutates a `structuredClone` of the state.
   - A business rejection returns `{ok:false, message}`. A thrown error is caught. Both become a 422 response.
   - `context` provides `now`, `actor`, `today` (the Mexico City date), `requestId` (the command id) and the verified uploads.
   - Most handlers add an entry to the front of `state.events`.
7. **Commit.** `commitState` in `lib/store.ts` writes the changed fragments, the new revision and an `erp_actions` row in one guarded D1 batch. A request that loses a race gets 409.
8. **Response.** Every state response passes through `projectState` in `lib/state-view.mjs`. It removes `security` and finance data according to the user's permissions, and it recomputes the V43 settlement ledger on clones.

Other routes:
- `GET /api/state` returns the full state plus `revision` and `access`.
- `GET /api/revision` is polled by `shared-sync-ui.js` to detect saves by other users.
- `/api/audit` lists recent `erp_actions`.
- `/api/team` saves roles and users.
- `/api/documents` uploads files to R2 under `{workspace}/documents/{sha256}`.
- The remaining routes serve product images, SAT catalogs, original cheques (finance users only), competition pricing and maintenance.

### Persistence (`lib/store.ts`, `lib/state-codec.mjs`, `db/schema.ts`)
- Each workspace is a single JSON document, not a relational model. Three tables store it:
  - `erp_fragments` holds the document split by top-level key into UTF-8-safe parts of at most 90,000 bytes.
  - `erp_workspaces` holds the revision and the last action.
  - `erp_actions` is both the audit log and the idempotency table.
- Commits compare the fragments before and after a command. Code that only computes display values must therefore never mutate the loaded state; doing so caused a real V43 persistence bug (`docs/V43-reconciliation.md`). Clone the state first, as `projectState` does.
- A workspace is seeded once, on its first read, from the `data/` JSON bundled into the worker. Changing the seed files later does not alter an already initialized workspace.
- Every read of `v43` runs deterministic campaign and mapping maintenance. When that changes anything, it commits a system `pricing.event.maintenance` action.
- If the `v43` fragments fail to parse, a one-off guarded recovery restores from `data/recovery-v43-revision3.json`.

### Workspaces (`lib/workspace-policy.mjs`)
- `v43` is the only operative workspace. `resolveWorkspace` maps `v43`, `v28`, `practice` and an empty value to `v43`.
- The physical `v28` row survives only to hold the team `security` policy (`readTeamPolicy`, `/api/team`).
- The separate V28 and practice workspaces described in the README no longer exist.

### Engines shared by server and browser
- Business rules are ES modules in `lib/*.mjs`. The server imports them from `lib/`. `scripts/sync-client.mjs` copies a fixed list of them byte-for-byte into `public/erp/modules/` for the browser.
- Never edit `public/erp/modules/`, `lib/shell.ts` or `lib/legacy-domain.mjs` by hand. Change the source and re-run the sync.
- An engine the browser needs must be added to the list in `sync-client.mjs` and imported in `public/erp/boot-v28.mjs`.
- `lib/legacy-domain.cjs` is the original v1 engine and becomes the global `D` in the browser. `public/erp/domain.js` is a byte-identical copy that the sync script does not update, so keep the two identical by hand.
- The browser computes previews with the same engines, but `applyCommand` on the server is the authority.

### Browser UI (`public/erp/`)
- `index.html` loads classic `defer` scripts that share these globals: `state`, `render`, `navigate`, `toast`, `esc` and `ERP`.
- `runtime-v28.js` defines `ERP`. `ERP.reload()` loads the state. `ERP.command(type, payload)` posts to `/api/action` with a fresh id and the current revision.
- `app.js` is the base UI. Feature scripts extend it by wrapping globals or renderers (`const previousRender = render; render = function …`, `renderers[key]`) and by exposing `window.<Feature>` objects. Script order in `index.html` therefore matters.
- `boot-v28.mjs` is the only module script. It imports the synced engines into `ERP.engines`, then loads the state and the route.
- Cache busting is manual, through a `?v=YYYYMMDD-tag` suffix in three places:
  - on the tags in `index.html`;
  - on the imports in `boot-v28.mjs`;
  - on relative imports between `lib/*.mjs` files, because the browser fetches those too.

  Bump the tag wherever you change a file. After editing `index.html`, re-run the sync.
- PDF.js and Tesseract OCR (Spanish and English) read documents in the browser, from `public/erp/vendor/`. The result is a draft that the user reviews, and the server validates it again.

## Domain rules that span modules
- **Money** is stored as integer MXN cents (`*Cents`). `averageCostMxn` keeps the imported precision. An unknown amount stays `null` and is shown as "Por confirmar". It never becomes 0.
- **Dates.** Excel calendar dates keep the day as written. Timestamps with `Z` or an offset are displayed and grouped in `America/Mexico_City` time.
- **Stock** is split into `good`, `reserved`, `quarantine`, `damaged` and `safety`. `sourceStock` keeps the imported figure. Imported historical sales (`stockMode: 'historical'`) never decrement stock.
- **These events never trigger each other:**
  - Saving a purchase or its invoices never adds stock. Only `inventory.receivePurchase` does.
  - A refund never creates stock. The return must first be received and inspected.
  - Document evidence never confirms a bank deposit. In V43 the chain is cheque → order link → Banamex credit → per-sale deposit.
- **Integrations.** No external integration is live: VentiApp, SICAR, marketplaces, banks and SAT/CFDI are all disconnected. `stockSyncQueue` only records what would be published.
- **Permissions** are `sales`, `inventory`, `purchases`, `finance`, `finance_read`, `pricing`, `settings`, `warehouses` and `access`.
  - The owner (`OWNER_EMAIL` in `lib/access.ts`) has all of them.
  - Local dev on localhost acts as the owner.
- **Data.** `data/` holds real business records: the seeds, SAT catalogs, original cheques and the recovery snapshot. They are bundled into the worker, and the repository must stay private.
