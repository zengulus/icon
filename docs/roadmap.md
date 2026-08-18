# Rules-first delivery roadmap

Phase boundaries are acceptance gates. A later phase may have engineering scaffolding, but it is not a production feature until every earlier gate passes.

## Phase 1 — Rules and character management (active)

- [x] Reproducible, credited extraction of the supplied ICON 1.5 sourcebook.
- [x] Searchable 501-page compendium and versioned structured catalogs for Bonds, Jobs, abilities, Relics, and foes.
- [x] Framework-independent TypeScript rules package with character schemas, migration, validation, deterministic dice, and event reducers.
- [x] Rules-backed character manager with local persistence, Supabase sync, import/export, and GitHub Pages deployment workflow.
- [x] Source-derived fixtures for character creation, advancement, content cardinality, foe taxonomy, and core encounter behavior.
- [ ] Normalize trophies, camp fixtures, and the remaining equipment/reward catalogs.
- [ ] Implement dedicated Refocus and all Relic infusion/aspect transitions.
- [ ] Make every encounter-relevant class trait, Job ability, talent, mastery, Limit Break, Relic effect, foe ability, and legend component executable.

Phase 1 exits only when representative character builds and all encounter-required content validate without unresolved gameplay behavior.

## Phase 2 — Rules-driven local VTT (gated)

The local browser harness already exercises maps, actors, turns, movement, basic abilities, straightforward attacks, terrain, damage, statuses, persistence, and event replay. Production access remains disabled.

Remaining acceptance work includes area templates, target selection, summons/objects, marks, stances, interrupts and trigger ordering, class resources, mobs, complete foe behavior, Relic invokes, source-derived encounter fixtures, and exhaustive replay tests. Any defect found here must be corrected in the shared rules package or structured content rather than patched into the UI.

## Phase 3 — Multiplayer VTT (gated)

The Render/Supabase/WebSocket path exists as an engineering preview: server authority, validated commands, authentication, campaign roles, optimistic revisions, persistence, reconnection, and server-side Discord activity notices are scaffolded.

It remains gated on Phase 2. Before release it also needs full multiplayer integration tests, campaign invitations/session UX, reconnect recovery under load, authoritative actor assignment, durable activity replay, and deployment smoke tests against configured Supabase and Render projects.
