/**
 * Audit the automation architecture one-way dependency rule:
 *
 *   content → kernels → primitives
 *
 * Exit code 1 on any violation.
 */

import { resolve } from 'node:path';
import { auditArchitecture } from './audit-architecture-core.js';

const AUTOMATION = resolve(import.meta.dirname, '../src/rules/automation');
const result = auditArchitecture(AUTOMATION);

console.log(JSON.stringify(result, null, 2));

if (result.violations.length > 0) {
  console.error(`\n❌ Architecture audit failed: ${result.violations.length} violation(s).`);
  process.exitCode = 1;
} else {
  console.log(`\n✅ Architecture audit passed (${result.checked.totalFiles} files checked).`);
}
