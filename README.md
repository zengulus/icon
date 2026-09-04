# ICON Field Guide

A rules-first ICON 1.5 character manager, searchable compendium, tactical test harness, and multiplayer service. The static React client deploys to GitHub Pages; Supabase provides authentication, durable data, and asset storage; Render hosts the authoritative websocket service.

The project does not claim affiliation with Massif Press. ICON, its text, art, layout, and writing are by Tom Bloom. The supplied playtest says the book may be printed or shared when its credits page is included; the generated compendium preserves that attribution.

## What works

- All 501 pages of the supplied sourcebook are reproducibly extracted into a 75-section, full-text compendium.
- Structured catalogs cover all 12 Bonds and 120 powers, all 16 Jobs and 144 abilities, all 40 Relics, and 449 color-resolved foe profiles/components with 1,365 costed abilities.
- Character creation and advancement validate Kin, Culture, Bond, action ratings, powers, Job slots, AP, talents, masteries, six-ability loadouts, Relic slots, gear, resources, and level/chapter limits.
- Level-0 characters from the legacy external `.icon` format (`Douglas.icon`) import fully offline from the Dashboard: display labels are translated to canonical IDs strictly at the import boundary, and conversion reuses the native level-0 creation validation before persisting through the same local-first save path. Import-only — no legacy export is offered.
- Characters save locally without configuration or sync through Supabase when configured.
- ICON Connect gives each browser a cryptographically bound local player identity (a non-extractable ECDSA P-256 private key held only in IndexedDB, with a public `icon_connect.json` instance descriptor). When the Render service is available, that instance can create a username/password account, prove instance possession with a signed challenge, and bind its locally-created characters to one backend user. Usernames and passwords are never persisted by the application — the password lives only in the HTTPS request and Supabase Auth, and the username only in server-side profile state.
- Versioned JSON import/export and schema migration are built in.
- Narrative rolls implement zero-rating rolls, boons/curses, and criticals.
- The shared encounter reducer implements movement, core terrain, basic attacks, armor, cover, vigor, statuses, wounds, recovery, deterministic events, and replay. Turn order is scheduler-driven: combat starts awaiting an explicit player-character selection, sides alternate, Slow rounds are elected per round, and Delay persists across round boundaries. 143 of 144 Job abilities are on the independently reviewed execution allowlist with typed programs and replay fixtures; unresolved supporting rules remain explicitly gated or table-facing rather than silently approximated.
- The Render service validates network commands, authenticates users, enforces campaign roles and actor ownership, checks optimistic revisions, redacts GM-hidden state for players, and persists append-only room checkpoints.
- Discord webhook secrets remain server-side.

Phase 2 is intentionally production-gated. Combat settlement (post-combat personal Resolve +1 and the durable attrition handoff between combats) is implemented, and foe roles now carry their production turn entitlements (Elites act twice per round; Legends act once per player character, defeated PCs included). Mobs, foe phases, Relic invokes, masteries, Limit Break effects, and other encounter-required content are still incomplete. See [rules coverage](docs/rules-coverage.md), the cross-cutting [rules foundations](docs/rules-foundations.md), the concrete [deliverables](docs/deliverables.md), and the [delivery roadmap](docs/roadmap.md). The current actionable backlog is [TODO.md](TODO.md).

## Local development

Requirements: Node.js 24. The checked-in generated content is enough to run,
test, and build the application. The untracked `ICON 1.5.pdf` in the repository
root is required only for regeneration or full byte-for-byte extraction evidence.

```sh
npm install
npx playwright install chromium # first time only; CI installs it automatically
npm test
npm run test:e2e
npm run dev
```

To regenerate the checked-in content after changing extraction logic, first
verify the supplied PDF against the pinned source identity. The full verifier
regenerates only into a temporary directory and compares those results with the
checked-in artifacts:

```sh
npm run verify:extraction
npm run extract:rules
npm test
```

The app runs at `http://localhost:5173`. With no environment variables it uses browser storage; `#/lab` is always the browser-local human-testing service. Development builds also expose the separately gated engineering-preview routes.

To run the realtime service locally:

```sh
cp .env.example .env
npm run dev:server
```

`dev:USER_ID:gm` and `dev:USER_ID:player` tokens are reserved for the automated acceptance harness. Render accepts them only when both `NODE_ENV=test` and `ALLOW_DEV_AUTH=true`; normal local development and every production deployment must authenticate through Supabase. The companion browser identity path is likewise limited to Vite's unbuilt `--mode e2e` development server with `VITE_E2E_AUTH=true`; it cannot activate in a production build.

`#/lab` is a public, browser-local human-testing service: it deliberately runs without Supabase, Render, authentication, or shared checkpoints, and is available at every release phase (including a GitHub Pages deployment). It persists only in that browser. The real shared VTT is `#/vtt/:encounterId`; it and the multiplayer server enforce the rules-coverage phase gate. While the gate is incomplete, a production build or Render deployment cannot open an authoritative room.

## Supabase

1. Create a Supabase project.
2. Apply every migration in `supabase/migrations/` in filename order with the Supabase CLI or SQL editor. In particular, `202608220001_vtt_room_checkpoints.sql` removes browser authority over live room state and adds the append-only checkpoint store used by Render, and `202608301100_icon_connect_identity.sql` adds the username profile, instance-binding, and creator-instance character ownership tables plus the hardened compare-and-set save.
3. Add the GitHub Pages URL and local URL to the Auth redirect allow-list.
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` and equivalent GitHub Actions repository variables.
5. ICON Connect account creation is server-mediated: the Render service needs `ICON_CONNECT_PEPPER` (a server-only secret used to derive the opaque internal auth email; it must never reach the browser) alongside its existing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Without it the account endpoints respond 503 and the app stays local-only.

The migrations create RLS-protected characters, campaigns, memberships, encounter metadata, append-only encounter checkpoints, and a public-read/user-write `icon-assets` image bucket. Browser clients can list/create encounter metadata but never read or write a live checkpoint payload; Render's service role is the sole checkpoint authority and must never use a `VITE_` prefix. Checkpoint history is bounded by retention class (at most 234 retained snapshots per room), and snapshots persist the current room-state projection with an empty event log; replay history remains a runtime/transport concern. If a newest checkpoint is corrupt, Render validates an older snapshot and writes a new `recovery` checkpoint above the corrupt revision instead of overwriting history.

## GitHub Pages

The workflow in `.github/workflows/ci.yml` audits rules automation, runs unit/integration tests, launches the compiled realtime service for transport acceptance, runs a Chromium browser acceptance flow against GM/player routes, and builds every push. On `main`, it publishes `dist/` through GitHub Pages. `#/lab` works there with no environment variables or backend: it is deliberately browser-local. Configure these repository variables only when the authenticated companion UI should also connect to Supabase and Render:

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

Render exposes `/health` and `/realtime`. The `/api/connect` account endpoints (challenge, register, login, status) live on the same service; they are rate-limited per caller and never log request bodies. Encounter and table commands are authoritative on the server and use the same room reducer as the local harness; durable checkpoints are written before a GM receives a save-complete acknowledgement. Per-user room command, ping, and save limits protect the room fan-out path. Discord receives session start/end notices; webhook URLs are never sent to the browser.

The current room manager is intentionally a single Render instance. Its in-memory live authority is not a distributed room lease or broker, so do not horizontally scale or overlap realtime deployments until a lease/relay layer is added. Checkpoint compare-and-set protects durable snapshots from a stale writer; it does not make two active in-memory rooms safe.

## Source extraction in CI

`ICON 1.5.pdf` is intentionally untracked and is therefore unavailable to a normal GitHub Actions checkout. Hosted CI explicitly runs `npm run verify:source-artifacts -- --expect-source-pdf=absent`: it validates the checked-in artifact structure and pinned artifact digests, and records that it did **not** rerun extraction. It cannot prove generated bytes came from the PDF without that input.

Maintainers changing extraction logic or generated content must run `npm run verify:extraction` locally with the supplied PDF. That command verifies the pinned source SHA-256, regenerates each artifact into a temporary directory, and requires a byte-for-byte match with the checked-in result. Update the source digest only after reviewing an intentional source-PDF change; after any reviewed parser or source change, run `npm run extract:rules`, update the checked-in artifact evidence digests deliberately, and commit the result.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run extract:rules` | Rebuild the generated compendium from `ICON 1.5.pdf` |
| `npm run verify:source-artifacts` | Validate checked-in generated artifact evidence; validates the pinned PDF too when it is locally available |
| `npm run verify:extraction` | Regenerate into a temporary directory and require byte-for-byte agreement with checked-in artifacts |
| `npm run dev` | Start the GitHub Pages client locally |
| `npm run dev:server` | Start the Render websocket/API service locally |
| `npm test` | Run rules and reducer tests |
| `npm run test:e2e:transport` | Build and exercise the compiled realtime service over HTTP/WebSockets using isolated test persistence |
| `npm run test:e2e:browser` | Run Chromium GM/player route acceptance against isolated local Vite and realtime servers |
| `npm run test:e2e` | Run both authoritative transport and browser acceptance suites |
| `npm run typecheck` | Type-check client, rules engine, and server |
| `npm run build` | Produce `dist/` and `dist-server/` |
