// Throwaway helper: dump normalized text of given PDF pages.
// Usage: node --import tsx scripts/page-dump.tmp.ts <firstPage> [lastPage]
// Delete before commit; uses the same pdfjs-dist setup as extract-icon.ts.
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? first);
const data = new Uint8Array(await readFile('ICON 1.5.pdf'));
const document = await pdfjs.getDocument({ data }).promise;
for (let n = Math.max(1, first); n <= Math.min(last, document.numPages); n += 1) {
  const page = await document.getPage(n);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str: string; hasEOL?: boolean }>;
  let text = '';
  for (const item of items) {
    text += item.str + (item.hasEOL ? '\n' : '');
  }
  console.log(`===== PDF PAGE ${n} =====`);
  console.log(
    text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
  console.log();
}
