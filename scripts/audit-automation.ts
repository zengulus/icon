import '../src/rules/automation/content/registry.js';
import { auditRuleCompilations } from '../src/rules/automation/content/glue/compiler.js';
import { collectRuleSourceUnits } from '../src/rules/source-units.js';

const { audit, compilations } = auditRuleCompilations(collectRuleSourceUnits());
console.log(JSON.stringify(audit, null, 2));
const unsupported = compilations.filter(({ unsupportedClauses }) => unsupportedClauses.length > 0).slice(0, 25);
for (const compilation of unsupported) {
  console.log(`\n${compilation.program.sourceId} — ${compilation.program.name}`);
  for (const clause of compilation.unsupportedClauses) console.log(`  [${clause.label}] ${clause.unsupportedText}`);
}
if (process.argv.includes('--strict') && audit.unsupportedClauses > 0) process.exitCode = 1;
