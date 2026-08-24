import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../src/rules/automation/content/jobs/programs');
const files = ['bastion-programs.ts', 'colossus-programs.ts', 'enochian-programs.ts', 'freelancer-programs.ts', 'harvester-programs.ts', 'knave-programs.ts', 'sealer-programs.ts', 'shade-programs.ts', 'spellblade-programs.ts', 'stormbender-programs.ts', 'warden-programs.ts'];
const outcome = /context\.triggers\?\.has\('(exceed|collide|slay)'\)/g;
const warnings: string[] = [];
for (const file of files) {
  const text = readFileSync(resolve(root, file), 'utf8');
  for (const match of text.matchAll(outcome)) warnings.push(`${file}:${text.slice(0, match.index ?? 0).split('\n').length}: caller-asserted ${match[1]} outcome trigger`);
}
if (warnings.length > 0) {
  console.warn(`Outcome-trigger bypass audit: ${warnings.length} bounded source-specific checks remain.`);
  for (const warning of warnings) console.warn(`  ${warning}`);
} else console.log('Outcome-trigger bypass audit passed.');
