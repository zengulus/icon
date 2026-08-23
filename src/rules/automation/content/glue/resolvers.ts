import { BASTION_RULE_RESOLVERS } from '../jobs/programs/bastion-programs.js';
import { CLASS_RULE_RESOLVERS } from '../classes/class-resolvers.js';
import { COLOSSUS_RULE_RESOLVERS } from '../jobs/programs/colossus-programs.js';
import { CORE_RULE_RESOLVERS } from '../../kernels/core-resolvers.js';
import { DEMON_SLAYER_RULE_RESOLVERS } from '../jobs/programs/demon-slayer-programs.js';
import { FOOL_RULE_RESOLVERS } from '../jobs/programs/fool-programs.js';
import { FREELANCER_RULE_RESOLVERS } from '../jobs/programs/freelancer-programs.js';
import { KNAVE_RULE_RESOLVERS } from '../jobs/programs/knave-programs.js';
import { SHADE_RULE_RESOLVERS } from '../jobs/programs/shade-programs.js';
import { WARDEN_RULE_RESOLVERS } from '../jobs/programs/warden-programs.js';
import { CHANTER_RULE_RESOLVERS } from '../jobs/programs/chanter-programs.js';
import { HARVESTER_RULE_RESOLVERS } from '../jobs/programs/harvester-programs.js';
import { SEALER_RULE_RESOLVERS } from '../jobs/programs/sealer-programs.js';
import { SEER_RULE_RESOLVERS } from '../jobs/programs/seer-programs.js';
import { ENOCHIAN_RULE_RESOLVERS } from '../jobs/programs/enochian-programs.js';
import { GEOMANCER_RULE_RESOLVERS } from '../jobs/programs/geomancer-programs.js';
import { SPELLBLADE_RULE_RESOLVERS } from '../jobs/programs/spellblade-programs.js';
import { STORMBENDER_RULE_RESOLVERS } from '../jobs/programs/stormbender-programs.js';
import { buildFoeRuleResolvers } from '../../kernels/foe-recipes.js';
import { FOE_ABILITY_RECIPES } from '../foes/ability-recipes.js';
import { JOB_TRAIT_RULE_RESOLVERS } from '../jobs/job-trait-resolvers.js';
import type { RuleResolverRegistry } from '../../primitives/types.js';

export const RULE_RESOLVERS: RuleResolverRegistry = {
  ...CORE_RULE_RESOLVERS,
  ...CLASS_RULE_RESOLVERS,
  ...JOB_TRAIT_RULE_RESOLVERS,
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
  ...buildFoeRuleResolvers(FOE_ABILITY_RECIPES),
};

export function hasRuleResolver(id: string) {
  return Boolean(RULE_RESOLVERS[id]);
}
