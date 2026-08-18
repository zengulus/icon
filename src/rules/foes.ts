import foes from '../content/generated/foes-1.5.json' with { type: 'json' };
import type { FoeKind, FoeProfileDefinition, FoeRoleDefinition, FoeRoleId } from './types.js';

export const FOE_ROLES: readonly FoeRoleDefinition[] = [
  {
    id: 'mob', name: 'Mob', vitality: null, hp: null, hpPerPlayer: null, minimumHp: null,
    speed: 4, dash: 2, defense: 8, fray: 3, damageDie: 6, membersPerPlayer: 2, memberHits: 2,
    traitsText: 'Two members per player. Each member is removed after two hits and does not trigger slay effects.',
    source: { page: 298, sectionId: 'foe-glossary' },
  },
  {
    id: 'heavy', name: 'Heavy', vitality: 10, hp: 40, hpPerPlayer: null, minimumHp: null,
    speed: 4, dash: 2, defense: 6, fray: 4, damageDie: 6, membersPerPlayer: null, memberHits: null,
    traitsText: 'Guard grants Rampart and reduces damage to self and orthogonally adjacent allies by 2 as armor.',
    source: { page: 298, sectionId: 'foe-glossary' },
  },
  {
    id: 'skirmisher', name: 'Skirmisher', vitality: 7, hp: 28, hpPerPlayer: null, minimumHp: null,
    speed: 4, dash: 4, defense: 10, fray: 2, damageDie: 10, membersPerPlayer: null, memberHits: null,
    traitsText: 'Moves diagonally, dashes at full speed, and has Dodge.',
    source: { page: 298, sectionId: 'foe-glossary' },
  },
  {
    id: 'leader', name: 'Leader', vitality: 10, hp: 40, hpPerPlayer: null, minimumHp: null,
    speed: 4, dash: 2, defense: 8, fray: 3, damageDie: 6, membersPerPlayer: null, memberHits: null,
    traitsText: 'Diaga can cure an ally in range 4 as one action.',
    source: { page: 298, sectionId: 'foe-glossary' },
  },
  {
    id: 'artillery', name: 'Artillery', vitality: 8, hp: 32, hpPerPlayer: null, minimumHp: null,
    speed: 4, dash: 2, defense: 7, fray: 3, damageDie: 8, membersPerPlayer: null, memberHits: null,
    traitsText: 'Slip ignores Rampart, interrupts, and Vigilance. Aetherwall resists abilities from outside range 2.',
    source: { page: 298, sectionId: 'foe-glossary' },
  },
  {
    id: 'legend', name: 'Legend', vitality: 10, hp: null, hpPerPlayer: 50, minimumHp: 100,
    speed: 4, dash: 2, defense: 8, fray: 3, damageDie: 8, membersPerPlayer: null, memberHits: null,
    traitsText: 'Takes one turn per player character. Juggernaut clears a status or mark at the start of a round.',
    source: { page: 298, sectionId: 'foe-glossary' },
  },
];

export const FOE_PROFILES: readonly FoeProfileDefinition[] = foes.profiles.map((profile) => ({
  ...profile,
  roleId: profile.roleId as FoeRoleId,
  kind: profile.kind as FoeKind,
  source: { page: profile.source.page, sectionId: profile.source.sectionId },
  abilities: profile.abilities.map((ability) => ({
    ...ability,
    cost: { ...ability.cost, kind: ability.cost.kind as FoeProfileDefinition['abilities'][number]['cost']['kind'] },
  })),
  automation: 'structured',
}));

export const FOE_ABILITIES = FOE_PROFILES.flatMap((profile) => profile.abilities);

export const findFoeRole = (id: FoeRoleId) => FOE_ROLES.find((role) => role.id === id);
export const findFoeProfile = (id: string) => FOE_PROFILES.find((profile) => profile.id === id);
