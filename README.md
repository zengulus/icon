# ICON Field Guide

A rules-first ICON 1.5 character manager, searchable compendium, tactical test harness, and multiplayer service. The static React client deploys to GitHub Pages; Supabase provides authentication, durable data, and asset storage; Render hosts the authoritative websocket service.

The project does not claim affiliation with Massif Press. ICON, its text, art, layout, and writing are by Tom Bloom. The supplied playtest says the book may be printed or shared when its credits page is included; the generated compendium preserves that attribution.

## What works

- All 501 pages of the supplied sourcebook are reproducibly extracted into a 74-section, full-text compendium.
- Structured catalogs cover all 12 Bonds and 120 powers, all 16 Jobs and 144 abilities, all 40 Relics, and 445 color-resolved foe profiles/components with 1,365 costed abilities.
- Character creation and advancement validate Kin, Culture, Bond, action ratings, powers, Job slots, AP, talents, masteries, six-ability loadouts, Relic slots, gear, resources, and level/chapter limits.
- Characters save locally without configuration or sync through Supabase when configured.
- Versioned JSON import/export and schema migration are built in.
- Narrative rolls implement zero-rating rolls, boons/curses, and criticals.
- The shared encounter reducer implements movement, core terrain, basic abilities, straightforward Job attacks, armor, cover, vigor, statuses, wounds, recovery, deterministic events, and replay.
- The Render service validates network commands, authenticates users, enforces campaign roles and actor ownership, checks optimistic revisions, broadcasts events, and persists encounter state.
- Discord webhook secrets remain server-side.

Phase 2 is intentionally production-gated. Source and major mechanical catalogs are structured, but complex Job effects, Relic invokes, mobs, summons, area placement, and foe/legend behavior are not all executable. See [rules coverage](docs/rules-coverage.md) and the [delivery roadmap](docs/roadmap.md).

## Local development

Requirements: Node.js 24 and the untracked `ICON 1.5.pdf` in the repository root.

```sh
npm install
npm run extract:rules
npm test
npm run dev
```

The app runs at `http://localhost:5173`. With no environment variables it uses browser storage and exposes the tactical engineering harness because Vite is in development mode.

To run the realtime service locally:

```sh
cp .env.example .env
npm run dev:server
```

For local websocket testing without Supabase, join with a token in the form `dev:USER_ID:gm` or `dev:USER_ID:player`. Development authentication is disabled in production.

## Supabase

1. Create a Supabase project.
2. Apply `supabase/migrations/202608190001_initial.sql` with the Supabase CLI or SQL editor.
3. Add the GitHub Pages URL and local URL to the Auth redirect allow-list.
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` and equivalent GitHub Actions repository variables.

The migration creates RLS-protected characters, campaigns, memberships, encounters, and a public-read/user-write `icon-assets` image bucket. Service-role credentials are used only by Render and must never use a `VITE_` prefix.

## GitHub Pages

The workflow in `.github/workflows/ci.yml` tests and builds every push. On `main`, it publishes `dist/` through GitHub Pages. Configure these repository variables:

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

Render exposes `/health` and `/realtime`. Encounter commands are authoritative on the server and use the same reducer as the local harness. Discord receives session start/end notices; webhook URLs are never sent to the browser.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run extract:rules` | Rebuild the generated compendium from `ICON 1.5.pdf` |
| `npm run dev` | Start the GitHub Pages client locally |
| `npm run dev:server` | Start the Render websocket/API service locally |
| `npm test` | Run rules and reducer tests |
| `npm run typecheck` | Type-check client, rules engine, and server |
| `npm run build` | Produce `dist/` and `dist-server/` |
