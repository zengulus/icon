import { CLASS_RULE_RESOLVERS } from './class-resolvers.js';
import { CORE_RULE_RESOLVERS } from './core-resolvers.js';
import type { RuleResolverRegistry } from './types.js';

export const RULE_RESOLVERS: RuleResolverRegistry = {
  ...CORE_RULE_RESOLVERS,
  ...CLASS_RULE_RESOLVERS,
};

export function hasRuleResolver(id: string) {
  return Boolean(RULE_RESOLVERS[id]);
}
