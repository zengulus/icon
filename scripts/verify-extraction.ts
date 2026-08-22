import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertKnownIconSource, resolveIconSourcePath, sha256 } from './source-artifact.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolveIconSourcePath();

let source: Buffer;
try {
  source = await readFile(sourcePath);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error(`Full extraction verification requires the supplied ICON 1.5 PDF at ${sourcePath}. Set ICON_SOURCE_PDF to use another local path.`);
  }
  throw error;
}
const sourceDigest = assertKnownIconSource(source, sourcePath);

function runExtractor(script: string, outputPath: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, sourcePath, outputPath], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${script} exited with status ${code ?? 'unknown'}.`));
    });
  });
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'icon-extraction-evidence-'));
try {
  const artifacts = [
    { name: 'sourcebook', script: 'scripts/extract-icon.ts', filename: 'icon-1.5.json' },
    { name: 'mechanics', script: 'scripts/extract-mechanics.ts', filename: 'mechanics-1.5.json' },
    { name: 'foes', script: 'scripts/extract-foes.ts', filename: 'foes-1.5.json' },
    { name: 'rewards', script: 'scripts/extract-rewards.ts', filename: 'rewards-1.5.json' },
  ] as const;

  for (const artifact of artifacts) {
    const regeneratedPath = join(temporaryDirectory, artifact.filename);
    await runExtractor(resolve(repoRoot, artifact.script), regeneratedPath);
    const [regenerated, checkedIn] = await Promise.all([
      readFile(regeneratedPath),
      readFile(resolve(repoRoot, 'src/content/generated', artifact.filename)),
    ]);
    if (!regenerated.equals(checkedIn)) {
      throw new Error(
        `${artifact.name} extraction differs from the checked-in ${artifact.filename} `
        + `(regenerated ${sha256(regenerated)}, checked-in ${sha256(checkedIn)}). `
        + 'Review the source/parser change and run npm run extract:rules before committing.',
      );
    }
    console.log(`${artifact.name}: byte-for-byte match.`);
  }
  console.log(`Full extraction evidence passed for source SHA-256 ${sourceDigest}.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
