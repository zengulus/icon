import { registerHpThresholdProjection } from '../../kernels/hp-threshold.js';

/**
 * Reviewed HP-threshold foe-trait passives (content/foes).
 *
 * Each row registers one source passive into the generic HP-threshold kernel
 * (`kernels/hp-threshold.ts`): the threshold ("bloodied" = at or under 50% of
 * the wounds-adjusted maximum, "quarter" = at or under 25%), the optional
 * inverted gate ("Loses X when bloodied"), and the ephemeral conditions /
 * +actions membership projects. The kernel derives activation continuously
 * from authoritative HP — nothing here persists a "bloodied active" boolean,
 * so healing across the threshold removes the projection immediately. The
 * row doubles as the trait's audit compilation
 * (`compileHpThresholdFoeTraitRecipe`), so the exact source unit becomes
 * executable through the generic engine.
 *
 * Enrage rows: "+1 action while bloodied" (p.298 glossary "Enrage"). The
 * +1 action is projected at turn start from current HP (the shared
 * turn-start authority), so a bloodied foe acts with 3 actions and one that
 * heals above half acts with 2 — derived, never stored.
 */

// ICON p.346 Brawler Beast: the bare glossary keyword "Enrage" (p.298:
// "+1 action while bloodied").
registerHpThresholdProjection({
  sourceId: 'ruin-beast:brawler-beast:346:trait:special-traits',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.301 Berserker: "Enrage: While bloody, gain +1 action."
registerHpThresholdProjection({
  sourceId: 'basic:berserker:301:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.308 Archon: "Enrage: +1 action while bloodied."
registerHpThresholdProjection({
  sourceId: 'basic:archon:308:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.308 Rogue: "Slippery: Has Evasion while bloodied."
registerHpThresholdProjection({
  sourceId: 'basic:rogue:308:trait:slippery',
  threshold: 'bloodied',
  conditions: ['evasion'],
});

// ICON p.373 Mondo: "Enrage: +1 action when bloodied."
registerHpThresholdProjection({
  sourceId: 'scavenger:mondo:373:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.393 War Beast: "Enrage: Gain +1 action while bloodied."
registerHpThresholdProjection({
  sourceId: 'imperial:war-beast:393:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.437 Battle Beetle: "Enrage: +1 action when bloodied"
registerHpThresholdProjection({
  sourceId: 'lowlander:battle-beetle:437:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.456 Aetnir: "Enrage: +1 action when bloodied"
registerHpThresholdProjection({
  sourceId: 'jotunn:aetnir:456:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.475 Beast Spirit: "Enrage: +1 action when bloodied."
registerHpThresholdProjection({
  sourceId: 'hob:beast-spirit:475:trait:enrage',
  threshold: 'bloodied',
  actions: 1,
});

// ICON p.450 Bloody Companion: "True Enrage: +1 action and unstoppable while
// bloodied."
registerHpThresholdProjection({
  sourceId: 'jotunn:bloody-companion:450:trait:true-enrage',
  threshold: 'bloodied',
  actions: 1,
  conditions: ['unstoppable'],
});

// ICON p.375 Churn Baron: "Arkentech Hover Chair: Flying and Sturdy. Loses
// both when bloodied." The inverted gate projects flying + sturdy while the
// owner is NOT bloodied.
registerHpThresholdProjection({
  sourceId: 'scavenger:churn-baron:375:trait:arkentech-hover-chair',
  threshold: 'bloodied',
  inverted: true,
  conditions: ['flying', 'sturdy'],
});
