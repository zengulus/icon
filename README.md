# ICON Field Guide

A rules-first ICON 1.5 character manager, searchable compendium, tactical test harness, and multiplayer service. The static React client deploys to GitHub Pages; Supabase provides authentication, durable data, and asset storage; Render hosts the authoritative websocket service.

The project does not claim affiliation with Massif Press. ICON, its text, art, layout, and writing are by Tom Bloom. The supplied playtest says the book may be printed or shared when its credits page is included; the generated compendium preserves that attribution.

## What works

- All 501 pages of the supplied sourcebook are reproducibly extracted into a 75-section, full-text compendium.
- Structured catalogs cover all 12 Bonds and 120 powers, all 16 Jobs and 144 abilities, all 40 Relics, and 449 color-resolved foe profiles/components with 1,365 costed abilities.
- Character creation and advancement validate Kin, Culture, Bond, action ratings, powers, Job slots, AP, talents, masteries, six-ability loadouts, Relic slots, gear, resources, and level/chapter limits.
- Characters save locally without configuration or sync through Supabase when configured.
- Versioned JSON import/export and schema migration are built in.
- Narrative rolls implement zero-rating rolls, boons/curses, and criticals.
- The shared encounter reducer implements movement, core terrain, basic attacks, armor, cover, vigor, statuses, wounds, recovery, deterministic events, and replay. Source-only Job abilities are deliberately blocked from changing state until they receive source-specific deterministic resolvers and replay fixtures.
- The Render service validates network commands, authenticates users, enforces campaign roles and actor ownership, checks optimistic revisions, redacts GM-hidden state for players, and persists append-only room checkpoints.
- Discord webhook secrets remain server-side.

Phase 2 is intentionally production-gated. Source and major mechanical catalogs are structured, but Job abilities, Relic invokes, mobs, summons, area placement, and foe/legend behavior are not all executable. See [rules coverage](docs/rules-coverage.md) and the [delivery roadmap](docs/roadmap.md).

## Local development

Requirements: Node.js 24. The checked-in generated content is enough to run,
test, and build the application. The untracked `ICON 1.5.pdf` in the repository
root is required only when regenerating source artifacts.

```sh
npm install
npx playwright install chromium # first time only; CI installs it automatically
npm test
npm run test:e2e
npm run dev
```

To regenerate the checked-in content after changing extraction logic or working
from a new supplied PDF:

```sh
npm run extract:rules
npm test
```

The app runs at `http://localhost:5173`. With no environment variables it uses browser storage and exposes the tactical engineering harness because Vite is in development mode.

To run the realtime service locally:

```sh
cp .env.example .env
npm run dev:server
```

`dev:USER_ID:gm` and `dev:USER_ID:player` tokens are reserved for the automated acceptance harness. Render accepts them only when both `NODE_ENV=test` and `ALLOW_DEV_AUTH=true`; normal local development and every production deployment must authenticate through Supabase. The companion browser identity path is likewise limited to Vite's unbuilt `--mode e2e` development server with `VITE_E2E_AUTH=true`; it cannot activate in a production build.

The multiplayer server enforces the same rules-coverage phase gate as the UI. While it is incomplete, only the explicit test harness or a local `NODE_ENV=development` process with `ALLOW_INCOMPLETE_VTT=true` can open engineering-preview rooms; a production Render deployment cannot override the gate.

## Supabase

1. Create a Supabase project.
2. Apply every migration in `supabase/migrations/` in filename order with the Supabase CLI or SQL editor. In particular, `202608220001_vtt_room_checkpoints.sql` removes browser authority over live room state and adds the append-only checkpoint store used by Render.
3. Add the GitHub Pages URL and local URL to the Auth redirect allow-list.
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` and equivalent GitHub Actions repository variables.

The migrations create RLS-protected characters, campaigns, memberships, encounter metadata, append-only encounter checkpoints, and a public-read/user-write `icon-assets` image bucket. Browser clients can list/create encounter metadata but never read or write a live checkpoint payload; Render's service role is the sole checkpoint authority and must never use a `VITE_` prefix. Checkpoint history is bounded by retention class (at most 234 retained snapshots per room), while recent combat history is capped at 500 events per snapshot. If a newest checkpoint is corrupt, Render validates an older snapshot and writes a new `recovery` checkpoint above the corrupt revision instead of overwriting history.

## GitHub Pages

The workflow in `.github/workflows/ci.yml` audits rules automation, runs unit/integration tests, launches the compiled realtime service for transport acceptance, runs a Chromium browser acceptance flow against GM/player routes, and builds every push. On `main`, it publishes `dist/` through GitHub Pages. Configure these repository variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_REALTIME_URL` (for example, `wss://icon-realtime.onrender.com/realtime`)

The UI uses hash routing, so direct links work on GitHub Pages without a custom `404.html`. The Vite base is `/icon/`; change it in `vite.config.ts` if the repository name differs.

## Render and Discord

Create a Blueprint from `render.yaml`, then set the secret values requested there:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_WEBHOOK_URL`
- `ALLOWED_ORIGINS` as a comma-separated list containing the GitHub Pages origin

Render exposes `/health` and `/realtime`. Encounter and table commands are authoritative on the server and use the same room reducer as the local harness; durable checkpoints are written before a GM receives a save-complete acknowledgement. Per-user room command, ping, and save limits protect the room fan-out path. Discord receives session start/end notices; webhook URLs are never sent to the browser.

The current room manager is intentionally a single Render instance. Its in-memory live authority is not a distributed room lease or broker, so do not horizontally scale or overlap realtime deployments until a lease/relay layer is added. Checkpoint compare-and-set protects durable snapshots from a stale writer; it does not make two active in-memory rooms safe.

## Source extraction in CI

`ICON 1.5.pdf` is intentionally untracked and is therefore unavailable to a normal GitHub Actions checkout. Hosted CI does not pretend to rerun `npm run extract:rules`; it validates the checked-in generated artifact's page count, section boundaries, cardinalities, provenance, and rules-source audit instead. Maintainers changing extraction logic or generated content must run `npm run extract:rules`, `npm test`, and review the generated artifact locally with the supplied PDF before committing the result.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run extract:rules` | Rebuild the generated compendium from `ICON 1.5.pdf` |
| `npm run dev` | Start the GitHub Pages client locally |
| `npm run dev:server` | Start the Render websocket/API service locally |
| `npm test` | Run rules and reducer tests |
| `npm run test:e2e:transport` | Build and exercise the compiled realtime service over HTTP/WebSockets using isolated test persistence |
| `npm run test:e2e:browser` | Run Chromium GM/player route acceptance against isolated local Vite and realtime servers |
| `npm run test:e2e` | Run both authoritative transport and browser acceptance suites |
| `npm run typecheck` | Type-check client, rules engine, and server |
| `npm run build` | Produce `dist/` and `dist-server/` |
