import rewards from '../content/generated/rewards-1.5.json' with { type: 'json' };
import type { CampFixtureDefinition, RewardRuleDefinition, TrophyDefinition } from './types.js';

export const GENERAL_TROPHIES: readonly TrophyDefinition[] = rewards.generalTrophies.map((trophy) => ({
  id: trophy.id,
  name: trophy.name,
  uses: { ...trophy.uses, period: trophy.uses.period as TrophyDefinition['uses']['period'] },
  rulesText: trophy.rulesText,
  source: { page: trophy.source.page, sectionId: trophy.source.sectionId },
  automation: 'structured',
}));

export const CAMP_FIXTURES: readonly CampFixtureDefinition[] = rewards.fixtures.map((fixture) => ({
  id: fixture.id,
  name: fixture.name,
  purchaseCost: fixture.purchaseCost,
  upgradeCost: fixture.upgradeCost,
  rulesText: fixture.rulesText,
  features: fixture.features.map((feature) => ({
    id: feature.id,
    name: feature.name,
    rulesText: feature.rulesText,
    source: { page: feature.source.page, sectionId: feature.source.sectionId },
    automation: 'structured',
  })),
  source: { page: fixture.source.page, sectionId: fixture.source.sectionId },
  automation: 'structured',
}));

const rewardRule = (id: string, name: string, page: number, rulesText: string): RewardRuleDefinition => ({
  id,
  name,
  rulesText,
  source: { page, sectionId: page >= 253 ? 'camp' : 'rewards' },
  automation: 'structured',
});

export const REWARD_RULES: readonly RewardRuleDefinition[] = [
  rewardRule('expedition-reward', 'Successful Expedition', 238, 'A successful expedition normally rewards each character 6 XP and 3 Dust.'),
  rewardRule('combat-dust', 'Combat Infusion', 242, 'Completing a tactical combat infuses 1 Dust into one Relic of the character’s choice.'),
  rewardRule('dust-cap', 'Dust Capacity', 242, 'A character can carry at most 8 uninvested Dust.'),
  rewardRule('relic-rank-cost', 'Relic Rank Cost', 242, 'Unlocking each of Relic ranks II and III costs 6 infused Dust.'),
  rewardRule('relic-aspect-cost', 'Relic Aspect Cost', 242, 'Aspecting a rank III Relic costs 12 Dust, or completion of its Aspect quest; after that quest has been completed once, matching Aspects cost 4 Dust.'),
  rewardRule('trophy-cap', 'Trophy Capacity', 242, 'A character can carry at most three Trophies. A Trophy is removed when its listed uses are depleted.'),
  rewardRule('post-combat-recovery', 'Post-combat Recovery', 100, 'After combat, heal to the next 25% HP segment; if at 25% HP or less, heal to 50% HP, never beyond the maximum imposed by Wounds.'),
  rewardRule('camp-reset', 'Camp Recovery', 238, 'Camping clears all Strain, restores all Effort and HP, and clears all accumulated personal Resolve.'),
  rewardRule('interlude-reset', 'Interlude Recovery', 239, 'Entering an interlude restores Strain, Effort, HP, and Wounds, then awards completed expedition rewards.'),
];

export const findTrophy = (id: string) => GENERAL_TROPHIES.find((trophy) => trophy.id === id);
export const findCampFixture = (id: string) => CAMP_FIXTURES.find((fixture) => fixture.id === id);
