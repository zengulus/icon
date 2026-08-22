import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * The supplied ICON 1.5 PDF is intentionally untracked.  Keeping its digest
 * here makes a changed input an explicit review event instead of letting the
 * extractors quietly replace the checked-in catalogs with a plausible-looking
 * result from a different document.
 */
export const ICON_SOURCE_PDF_FILENAME = 'ICON 1.5.pdf';
export const ICON_SOURCE_SHA256 = 'f6ed899d8fdc2e15213a4e524ea1c2569b9c9a9e81ec28a4f4b69c8bb0ee4734';

export function resolveIconSourcePath(sourcePath = process.env.ICON_SOURCE_PDF ?? ICON_SOURCE_PDF_FILENAME) {
  return resolve(sourcePath);
}

export function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertKnownIconSource(data: Uint8Array, sourcePath: string) {
  const actual = sha256(data);
  if (actual !== ICON_SOURCE_SHA256) {
    throw new Error(
      `Refusing to extract from ${sourcePath}: expected ICON 1.5 SHA-256 ${ICON_SOURCE_SHA256}, received ${actual}. `
      + 'The supplied source artifact changed; review its provenance and intentionally update the pinned digest before regenerating catalogs.',
    );
  }
  return actual;
}
