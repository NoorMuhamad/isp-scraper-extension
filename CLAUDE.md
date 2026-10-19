# isp-scraper-extension

"ISP Finder: Pakistan", a Chrome extension (Manifest V3) that searches Google Maps
city by city for internet service providers and sends them to the owner panel's
Prospects (and optionally a Google Sheet). React 19 + MUI side panel, built with
Vite.

## Commands (npm)

- Build: `npx vite build` → `dist/`. The owner loads `dist/` unpacked in Chrome;
  after a build they press reload on the extension in `chrome://extensions`.
- Lint: `npx eslint src` (clean on 2026-10-19).
- Commit checks: `.githooks/pre-commit` runs ESLint on the changed files on every commit (turned on
  per clone with `git config core.hooksPath .githooks`). Keep it passing; skip
  only in an emergency with `git commit --no-verify`.
- Tests are not in the repo: they were run from Node scripts with a fake `chrome`
  object (worker, sheet and owner-panel sync). Test the worker the same way when
  changing it.

## Layout

- `src/background/service-worker.js`: the job queue (one search at a time),
  saving and deduplicating listings, Google Sheet and owner-panel sync. All
  storage writes go through `withLock`.
- `src/content/content-script.js`: runs in Google Maps, reads listings. Must stay
  self-contained (no imports in content scripts).
- `src/shared/records.js`: cleaning, dedupe keys, CSV and `ispCheck` (ISPs only).
  `ispCheck` must stay identical to `isp-owner-backend/src/modules/prospects/isp-check.ts`.
- `src/components/`: side panel (Dashboard, Cities, Settings).
- `apps-script/Code.gs`: the Google Sheet receiver.

## Rules

- A city is scraped only while it's enabled; all 178 cities start disabled.
- Never try to get past Google's robot check: pause and let the person solve it.
- Keep the pace modest (pauses between listings) and don't reopen listings
  collected recently or found not to be ISPs.
- Collecting from Google Maps this way is against Google's terms; the owner chose
  to do it. Don't extend it to other sites or personal data.

## Internet Guru platform (shared by every repo)

Multi-tenant ISP management and billing platform for Pakistani ISPs. Each ISP
("company") gets its own subdomain (`<sub>.internet-guru.com`) and its own MySQL
database. Each project is its own repo (GitHub `NoorMuhamad/*`, branch `master`):

| Repo | What | Prod path / process |
|---|---|---|
| `isp-company-backend` | API for one ISP's panel and the mobile app; queues SMS/WhatsApp/push (NestJS, GraphQL, TypeORM, BullMQ) | `/root/Nest-Graph-Ql.` → pm2 `tenant-backend` (8080) + `tenant-worker` |
| `isp-company-frontend` | ISP admin panel (React 18 CRA, MUI, Apollo 3) | `/root/admin-panel` → static in `/var/www/admin-panel` |
| `isp-owner-backend` | Owner API: companies, provisioning, company DB migrations, WhatsApp, backups, prospects, marketing | `/root/isp-owner-back-end` → pm2 `owner-backend` (8081) |
| `isp-owner-frontend` | Owner panel + public site `internet-guru.com` (React 19, Vite, Tailwind 4) | `/root/isp-owner-frontend/dist` |
| `isp-mobile` | Customer app (React Native 0.84) | app stores |
| `isp-scraper-extension` | Chrome extension feeding Prospects | loaded unpacked from `dist/` |

- **Company DB schema changes are migrations in
  `isp-owner-backend/src/modules/provisioning/tenant-migrations.ts`**, run for every
  active company on owner-backend deploy (`pnpm run tenants:migrate`). The company
  backend never migrates.
- The owner database `isp_owner` holds the companies registry and the `customers`
  mirror the mobile app logs in through.
- Clients reach both backends through nginx at `https://internet-guru.com/api` and
  the subdomains; the company backend picks the company from the subdomain or the
  `x-tenant-subdomain` header.

**Production:** one Hetzner server, `135.181.29.138` (Ubuntu, nginx, MySQL 8.4,
Redis, pm2, Docker for httpSMS), used live by many ISPs. SSH:
`ssh -i ~/Downloads/hetzner.pem -o IdentitiesOnly=yes root@135.181.29.138`.
- **Every change on the production server needs the owner's approval first.** Show
  the exact commands and wait for an explicit "approve". Read-only checks are fine.
- Deploys: pushing to `master` runs `.github/workflows/deploy.yaml` over SSH
  (secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`). The owner pushes; Claude has no
  GitHub access.
- Nightly DB backups at 02:30 PKT to `/root/backups/daily` and S3 (15 days).
  Backups are deleted only by age, never for any other reason.

**Rules:**
- Never kill or restart the owner's running dev servers or processes by name
  (`pkill -f`, `killall`, freeing ports). Stop only processes you started, by PID.
  Tell the owner when their server needs a restart.
- Never use a password pasted into chat.
- Run the tests, type check and lint for what you change, and report failures as they are.
- Multi-tenant: company-backend queries must stay inside the current company; never
  mix company data. Prefer additive, backward-compatible migrations.
- Commit only when asked. End commit messages with the attribution line the session
  provides.
- Users are in Pakistan: time zone PKT (UTC+5), amounts in Rs, English and Urdu.
