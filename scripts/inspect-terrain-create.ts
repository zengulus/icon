import '../src/rules/automation/content/registry.js';
import { auditRuleCompilations } from '../src/rules/automation/content/glue/compiler.js';
import { collectRuleSourceUnits } from '../src/rules/source-units.js';
import { getExecutableTalentIds } from '../src/rules/automation/kernels/talent-recipes.js';
import { getDocumentedTalentIds } from '../src/rules/automation/content/jobs/talent-recipes.js';

const units = collectRuleSourceUnits();
const execTalents = getExecutableTalentIds();
const documented = getDocumentedTalentIds(units);

// Check current state
console.log(`Executable talents: ${execTalents.size}`);
console.log(`Documented talents: ${documented.size}`);

// List all terrain-create singleton talents from the census
const terrainSingletons = [
  'colossus:upheaval:talent:2',
  'colossus:great-suplex:talent:1',
  'warden:underway:talent:2',
  'warden:morrigan:talent:2',
  'warden:sidhe:talent:1',
  'seer:eclipse:talent:1',
  'seer:the-tower:talent:2',
  'enochian:implode:talent:2',
  'geomancer:bio:talent:1',
  'geomancer:bio:talent:2',
  'geomancer:terraforming:talent:2',
  'geomancer:realignment:talent:2',
  'geomancer:quaking-palm:talent:1',
  'spellblade:blitz:talent:1',
  'spellblade:rampant-nail:talent:1',
  'stormbender:rime:talent:1',
  'stormbender:tsunami:talent:1',
  'stormbender:heave-ho:talent:1',
  'stormbender:waterspout:talent:2',
  'stormbender:eye-of-the-storm:talent:1',
];

for (const id of terrainSingletons) {
  const unit = units.find(u => u.id === id);
  if (!unit) { console.log(`MISSING: ${id}`); continue; }
  const isExec = execTalents.has(id);
  const isDoc = documented.has(id);
  console.log(`${id}: ${isExec ? 'EXECUTABLE' : isDoc ? 'documented' : 'OTHER'}`);
}
