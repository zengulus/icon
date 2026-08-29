import { ACTIONS, BONDS, CULTURES, KINS } from './catalog.js';
import type { ActionId, BondDefinition, BondPowerDefinition, CultureDefinition, KinDefinition } from './types.js';

/**
 * Creation-facing projections for the player-selectable NARRATIVE catalog.
 *
 * These types deliberately carry ONLY identity + display data (`id`, `name`,
 * descriptions, rules text) and never the engine's implementation-status
 * fields (`automation`, `executable`, `structured`, `implemented`,
 * `unresolved`, ...). Selecting an item here means "the player chose source
 * content ID X" — nothing about whether that rule is executable.
 *
 * The underscore-prefixed `Unsafe` types document the projection boundary:
 * they are the structural vulnerable types (which CAN include automation
 * status) that the projection maps AWAY from, so a field can never leak into
 * the creation surface by accident.
 */

type _UnsafeKin = KinDefinition;
type _UnsafeCulture = CultureDefinition;
type _UnsafeBond = BondDefinition;
type _UnsafeBondPower = BondPowerDefinition;

export interface KinOption {
  readonly id: KinDefinition['id'];
  readonly name: KinDefinition['name'];
  readonly description: KinDefinition['description'];
}

export interface CultureOption {
  readonly id: CultureDefinition['id'];
  readonly name: CultureDefinition['name'];
  readonly description: CultureDefinition['description'];
}

export interface BondPowerOption {
  readonly id: BondPowerDefinition['id'];
  readonly bondId: BondPowerDefinition['bondId'];
  readonly name: BondPowerDefinition['name'];
  readonly rulesText: BondPowerDefinition['rulesText'];
}

export interface BondOption {
  readonly id: BondDefinition['id'];
  readonly name: BondDefinition['name'];
  readonly summary: BondDefinition['summary'];
  readonly actions: readonly [ActionId, ActionId];
  readonly powers: readonly BondPowerOption[];
  readonly secondWind: BondDefinition['secondWind'];
  readonly specialAbility: BondDefinition['specialAbility'];
  readonly kits: readonly { readonly name: string }[];
  readonly sourcePage: number;
}

export interface ActionOption {
  readonly id: ActionId;
  readonly name: string;
  readonly description: string;
}

export const kinOptions = (): readonly KinOption[] => KINS.map(({ id, name, description }) => ({ id, name, description }));
export const cultureOptions = (): readonly CultureOption[] => CULTURES.map(({ id, name, description }) => ({ id, name, description }));
export const actionOptions = (): readonly ActionOption[] => ACTIONS.map(({ id, name, description }) => ({ id, name, description }));
export const bondOptions = (): readonly BondOption[] => BONDS.map((bond): BondOption => ({
  id: bond.id,
  name: bond.name,
  summary: bond.summary,
  actions: [bond.actions[0], bond.actions[1]],
  powers: bond.powers.map((power): BondPowerOption => ({ id: power.id, bondId: power.bondId, name: power.name, rulesText: power.rulesText })),
  secondWind: bond.secondWind,
  specialAbility: bond.specialAbility,
  kits: bond.kits.map((kit) => ({ name: kit.name })),
  sourcePage: bond.source.page,
}));