import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertKnownIconSource, resolveIconSourcePath, sha256 } from './source-artifact.js';

type SourceExpectation = 'present' | 'absent' | 'either';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedArgument = process.argv.find((argument) => argument.startsWith('--expect-source-pdf='));
const expectedSource = (expectedArgument?.slice('--expect-source-pdf='.length) ?? 'either') as SourceExpectation;
const CHECKED_IN_ARTIFACT_SHA256: Readonly<Record<string, string>> = {
  'icon-1.5.json': '292df0bdf91af3ecbd52a3a45d7e83ec575eca8797817339272c50184910ede8',
  'mechanics-1.5.json': 'b5e4e64283221395d9fce8ea257d046d1f9d472684325922e08cf4de93db4e0f',
  'foes-1.5.json': 'aa4d575249f3988c50a3774af3184cb744058fa8f23526054c3a7bd60ad17868',
  'rewards-1.5.json': 'e46189d94bdbf622bd764b29ed825aac96abef62fb643f7e0aa73b1e1520ecf5',
};

if (!['present', 'absent', 'either'].includes(expectedSource)) {
  throw new Error('Expected --expect-source-pdf=present, --expect-source-pdf=absent, or no expectation.');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function sourcePdf() {
  const path = resolveIconSourcePath();
  try {
    return { path, data: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const source = await sourcePdf();
if (!source) {
  assert(expectedSource !== 'present', 'The supplied ICON 1.5 PDF is required for this check but is unavailable. Set ICON_SOURCE_PDF or place it at the repository root.');
  console.log('Source PDF: absent (expected for a normal hosted CI checkout); validating checked-in generated artifacts only.');
} else {
  assert(expectedSource !== 'absent', `Source PDF unexpectedly present at ${source.path}; hosted CI must not depend on an untracked source artifact.`);
  const digest = assertKnownIconSource(source.data, source.path);
  console.log(`Source PDF: present and matches pinned SHA-256 ${digest}.`);
}

const contentDirectory = resolve(repoRoot, 'src/content/generated');
const [sourcebook, mechanics, foes, rewards] = await Promise.all([
  readJson(resolve(contentDirectory, 'icon-1.5.json')),
  readJson(resolve(contentDirectory, 'mechanics-1.5.json')),
  readJson(resolve(contentDirectory, 'foes-1.5.json')),
  readJson(resolve(contentDirectory, 'rewards-1.5.json')),
]);

const sourceMetadata = sourcebook.metadata as Record<string, unknown>;
assert(sourcebook.schemaVersion === 1 && sourceMetadata?.pageCount === 501, 'icon-1.5.json is missing its expected 501-page source metadata.');
assert(Array.isArray(sourcebook.pages) && sourcebook.pages.length === 501, 'icon-1.5.json must contain all 501 source pages.');
assert(Array.isArray(sourcebook.sections) && sourcebook.sections.length === 75, 'icon-1.5.json must contain all 75 indexed sections.');

const mechanicCounts = mechanics.counts as Record<string, unknown>;
assert(mechanics.schemaVersion === 2 && mechanicCounts?.jobs === 16 && mechanicCounts.abilities === 144 && mechanicCounts.relics === 40 && mechanicCounts.bonds === 12,
  'mechanics-1.5.json does not match the expected 16 Jobs, 144 abilities, 40 Relics, and 12 Bonds.');

const foeCounts = foes.counts as Record<string, unknown>;
assert(foes.schemaVersion === 2 && foeCounts?.profiles === 449 && foeCounts.abilities === 1365,
  'foes-1.5.json does not match the expected 449 profiles and 1,365 abilities.');

const rewardCounts = rewards.counts as Record<string, unknown>;
assert(rewards.schemaVersion === 1 && rewardCounts?.generalTrophies === 20 && rewardCounts.fixtures === 16 && rewardCounts.fixtureFeatures === 87,
  'rewards-1.5.json does not match the expected 20 trophies, 16 fixtures, and 87 fixture features.');

for (const filename of Object.keys(CHECKED_IN_ARTIFACT_SHA256)) {
  const data = await readFile(resolve(contentDirectory, filename));
  const digest = sha256(data);
  assert(digest === CHECKED_IN_ARTIFACT_SHA256[filename],
    `${filename} differs from its pinned checked-in evidence (expected ${CHECKED_IN_ARTIFACT_SHA256[filename]}, received ${digest}). `
    + 'Run npm run verify:extraction with the supplied PDF, review the change, then deliberately update this evidence digest.');
  console.log(`${filename}: SHA-256 ${digest}`);
}

console.log('Checked-in source-artifact evidence is structurally valid. This check does not regenerate artifacts; run npm run verify:extraction with the supplied PDF for byte-for-byte extraction evidence.');
