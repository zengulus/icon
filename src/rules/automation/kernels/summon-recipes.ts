/**
 * F6 job-summon kernel (docs/rules-foundations.md §7).
 *
 * Every Job's "Summons" rules (six suites: fool bombs, shade shadows, warden
 * beasts, harvester thralls/plants, seer wild cards, stormbender salt
 * sprites) are a closed, source-ID-keyed registry — one row per suite, never
 * inferred from prose. The rows live in `content/jobs/summon-recipes.ts` and
 * register through `registerSummonSuites`; this module contains the registry
 * and the cap contract, with no source IDs of its own.
 *
 * The companion traits (Beast Master's great beast, Bound Spirit's seraph,
 * Selkie's elemental) are *combat-start* round-start lifecycle recipes in
 * `content/jobs/lifecycle-recipes.ts`; they are persistent summons that
 * survive their owner's defeat (`state.companion`), unlike the ephemeral
 * suite entities.
 */
export interface JobSummonSuite {
  /** The Job whose rules section owns this suite. */
  jobId: string;
  /** The source unit id (`${jobId}:summon-rules`). */
  sourceId: string;
  /** Entity types this suite covers (a suite can own one or two). */
  entityTypes: readonly string[];
  /** Default placement: a free space within this Chebyshev range of the
   * summoner unless a higher range is listed on the ability. */
  defaultRange: number;
  /** Maximum active entities of these types per owner. */
  maxActive: number;
  /** What the engine executes deterministically. */
  mechanic: string;
  /** The summon action/effect behavior that stays table-facing. */
  tableFacing: string;
}

const summonSuites: JobSummonSuite[] = [];

/** Register the Job summon suites (content/jobs/summon-recipes.ts). */
export function registerSummonSuites(suites: readonly JobSummonSuite[]): void {
  summonSuites.push(...suites);
}

/** The one suite row owning an entity type, or null when the type is not a
 * registered suite entity (objects, geysers, meteors, statues, portals…). */
export function summonSuiteFor(entityType: string): JobSummonSuite | null {
  return summonSuites.find((suite) => suite.entityTypes.includes(entityType)) ?? null;
}

/** Maximum active suite entities an owner may hold for an entity type. */
export function summonCap(entityType: string): number | null {
  return summonSuiteFor(entityType)?.maxActive ?? null;
}
