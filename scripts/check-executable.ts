import '../src/rules/automation/content/registry.js';
import { getExecutableTalentIds } from '../src/rules/automation/kernels/talent-recipes.js';
const ids = [...getExecutableTalentIds()].sort();
console.log('Executable talents:', ids.length);
for (const id of ids) console.log(`  ${id}`);
