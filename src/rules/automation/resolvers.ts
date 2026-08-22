import { BASTION_RULE_RESOLVERS } from './bastion-programs.js';
import { CLASS_RULE_RESOLVERS } from './class-resolvers.js';
import { COLOSSUS_RULE_RESOLVERS } from './colossus-programs.js';
import { CORE_RULE_RESOLVERS } from './core-resolvers.js';
import { DEMON_SLAYER_RULE_RESOLVERS } from './demon-slayer-programs.js';
import { FOOL_RULE_RESOLVERS } from './fool-programs.js';
import { FREELANCER_RULE_RESOLVERS } from './freelancer-programs.js';
import { KNAVE_RULE_RESOLVERS } from './knave-programs.js';
import { SHADE_RULE_RESOLVERS } from './shade-programs.js';
import { WARDEN_RULE_RESOLVERS } from './warden-programs.js';
import { CHANTER_RULE_RESOLVERS } from './chanter-programs.js';
import { HARVESTER_RULE_RESOLVERS } from './harvester-programs.js';
import { SEALER_RULE_RESOLVERS } from './sealer-programs.js';
import { SEER_RULE_RESOLVERS } from './seer-programs.js';
import { ENOCHIAN_RULE_RESOLVERS } from './enochian-programs.js';
import { GEOMANCER_RULE_RESOLVERS } from './geomancer-programs.js';
import { SPELLBLADE_RULE_RESOLVERS } from './spellblade-programs.js';
import { STORMBENDER_RULE_RESOLVERS } from './stormbender-programs.js';
import { FOE_RULE_RESOLVERS } from './foe-recipes.js';
import type { RuleResolverRegistry } from './types.js';

export const RULE_RESOLVERS: RuleResolverRegistry = {
  ...CORE_RULE_RESOLVERS,
  ...CLASS_RULE_RESOLVERS,
  ...BASTION_RULE_RESOLVERS,
  ...DEMON_SLAYER_RULE_RESOLVERS,
  ...COLOSSUS_RULE_RESOLVERS,
  ...KNAVE_RULE_RESOLVERS,
  ...FOOL_RULE_RESOLVERS,
  ...FREELANCER_RULE_RESOLVERS,
  ...SHADE_RULE_RESOLVERS,
  ...WARDEN_RULE_RESOLVERS,
  ...CHANTER_RULE_RESOLVERS,
  ...HARVESTER_RULE_RESOLVERS,
  ...SEALER_RULE_RESOLVERS,
  ...SEER_RULE_RESOLVERS,
  ...ENOCHIAN_RULE_RESOLVERS,
  ...GEOMANCER_RULE_RESOLVERS,
  ...SPELLBLADE_RULE_RESOLVERS,
  ...STORMBENDER_RULE_RESOLVERS,
  ...FOE_RULE_RESOLVERS,
};

export function hasRuleResolver(id: string) {
  return Boolean(RULE_RESOLVERS[id]);
}
