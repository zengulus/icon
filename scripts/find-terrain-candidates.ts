import '../src/rules/automation/content/registry.js';
import { auditRuleCompilations } from '../src/rules/automation/content/glue/compiler.js';
import { collectRuleSourceUnits } from '../src/rules/source-units.js';

const units = collectRuleSourceUnits();
const { compilations } = auditRuleCompilations(units);
const compilationMap = new Map(compilations.map((c) => [c.program.sourceId, c]));

// Find terrain-create singleton talents (after audit reclassifications)
const terrainUnits = units.filter((u) => {
  if (u.kind !== 'talent') return false;
  const comp = compilationMap.get(u.id);
  if (!comp || comp.unsupportedClauses.length === 0) return false;
  const text = u.rulesText.toLowerCase();
  // Must mention terrain creation
  if (!/create.*terrain|creates.*terrain|pit|difficult terrain|dangerous terrain|boulder|pillar|terrain effect|afterimage|terrain.*create/.test(text)) return false;
  // Must NOT mention other blockers (shove, range, area, condition, damage, etc.)
  // except terrain-create itself
  return !/shove.*(?:any|direction|\+1|distance)|range \d|gain range|area effect|counter|evasion|phasing|sturdy|unstoppable|stealth|dodge|regeneration|defiance|bonus damage|deal \d+ damage|vigor|fly \d|gain flying|aura\s*\d|cover|mark.*stack|summon.*(?:action|attack)|aether|infuse|gamble|charge.*die|free action|sacrifice \d|spend.*(?:blessing|combo)|cure.*(?:when|after)|vacate|teleport.*(?:choose|destination)/.test(text);
});

console.log('Eligible terrain-create singleton talents:');
for (const u of terrainUnits) {
  console.log(`  ${u.id} | ${u.rulesText}`);
}
console.log(`\nTotal: ${terrainUnits.length}`);
