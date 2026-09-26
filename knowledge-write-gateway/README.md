# Phase 9 HTTPS Write Gateway

This Vercel project is deployed with **Root Directory** set to `knowledge-write-gateway`. It is separate from the public GitHub Pages site. The browser holds only a short-lived, in-memory session; the GitHub write token and write secret must be configured **only** as Vercel environment variables. Never put them in Git, Pages, screenshots, chat, or localStorage.

## Deployment

1. Connect the GitHub repository to a new Vercel project and set its Root Directory to `knowledge-write-gateway`. Use the production branch containing this code.
2. Set `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH=knowledge-data`, `GITHUB_TOKEN`, `KNOWLEDGE_WRITE_SECRET`, and `ALLOWED_ORIGIN=https://lihuany635-create.github.io` in Vercel Production environment variables. Use a fine-grained GitHub token limited to this repository with Contents read/write. Use a random write secret of at least 24 characters, preferably 32+ random bytes. The GitHub token is repository-scoped, not branch-scoped: protect other branches and rotate the token if compromised.
3. Deploy. Check `GET /api/health` and `GET /api/sync/snapshot`. Then enter the resulting HTTPS origin in the workbench, verify the write secret, and send one non-sensitive test record. Confirm the record, indexes, and manifest on `knowledge-data` plus a second device's remote list before using real data.
4. Configure Vercel WAF/rate limits for `/api/auth/session` before public use. The code's in-memory failed-attempt lock is only a secondary control and does **not** coordinate across serverless instances.

Vercel Functions limit the request body to 4.5 MB, so this implementation caps each asset at 4 MiB. The source `knowledge-data` branch and assets are public: do not submit private or sensitive content. This gateway does not touch the Obsidian Vault or the separate `obsidian-web-sync` system.

## API contract

- `GET /api/health`: readiness.
- `GET /api/sync/snapshot`, `GET /api/records/:id`: public read.
- `POST /api/auth/session` with `{writeSecret}`: short-lived bearer session.
- `POST /api/assets`: authenticated bytes, UUID and MIME/SHA-256 headers, idempotency key.
- `PUT /api/records/:id` with `{expectedRevision, record}`: compare-and-swap create/update.
- `DELETE /api/records/:id` with `{expectedRevision}`: soft delete.

Each write uses a GitHub tree/commit/ref update to keep a record, indexes, manifest, and idempotency receipt together. A competing branch update causes a retry or conflict, never a force push. The browser retains failed jobs and does not automatically overwrite a remote conflict.

## Verification

From this folder: `npm test`. From repository root, with the local static site at `http://127.0.0.1:4187` and Playwright available: `node knowledge-workbench/dev/verify-phase9.cjs`. Earlier `verify-phase3.cjs` through `verify-phase8.cjs` remain the regression suite.
