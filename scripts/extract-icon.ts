import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assertKnownIconSource, resolveIconSourcePath } from './source-artifact.js';

type SectionSeed = readonly [id: string, title: string, startPage: number, category: string];

// Golden source identity. A changed source artifact must stop extraction for
// review instead of silently regenerating a superficially plausible catalog.
const EXPECTED_PAGE_COUNT = 501;
const EXPECTED_SECTION_COUNT = 75;

const sections: SectionSeed[] = [
  ['introduction', 'ICON: Legacy of the Arkenlords', 9, 'Introduction'],
  ['playing', 'Playing the Game', 11, 'Introduction'],
  ['getting-started', 'Getting Started', 13, 'Introduction'],
  ['narrative-play', 'Narrative Play', 17, 'Book of Tales'],
  ['action-examples', 'Specific Action Examples', 23, 'Book of Tales'],
  ['clocks', 'Clocks', 26, 'Book of Tales'],
  ['rituals-projects', 'Rituals and Projects', 28, 'Book of Tales'],
  ['gm-principles', 'GM Principles', 28, 'Book of Tales'],
  ['consequences', 'Complications and Consequences', 29, 'Book of Tales'],
  ['narrative-combat', 'Combat in Narrative Play', 31, 'Book of Tales'],
  ['narrative-characters', 'Player Characters in Narrative Play', 34, 'Book of Tales'],
  ['expeditions', 'Expeditions, Camps, and Interludes', 39, 'Book of Tales'],
  ['character-creation', 'Narrative Character Creation', 45, 'Character Creation'],
  ['kin', 'Folk of Arden Eld', 46, 'Character Creation'],
  ['cultures', 'The Six Great Cultures', 52, 'Character Creation'],
  ['bonds', 'Bonds', 55, 'Character Creation'],
  ['tactical-combat', 'Tactical Combat', 81, 'Book of Battle'],
  ['quick-combat', 'Quick Combat', 84, 'Book of Battle'],
  ['combat-step-by-step', 'Combat, Step by Step', 87, 'Book of Battle'],
  ['movement', 'Movement and the Battlefield', 87, 'Book of Battle'],
  ['abilities', 'Abilities', 91, 'Book of Battle'],
  ['resolve', 'Resolve and Limit Break', 99, 'Book of Battle'],
  ['healing', 'Vigor, Camping, and Healing', 100, 'Book of Battle'],
  ['victory-defeat', 'Victory and Defeat', 101, 'Book of Battle'],
  ['combat-glossary', 'Combat Glossary', 102, 'Book of Battle'],
  ['advanced-combat', 'Advanced Combat', 106, 'Book of Battle'],
  ['jobs', 'Choosing Your Job', 110, 'Jobs'],
  ['stalwart', 'Stalwart', 116, 'Jobs'],
  ['bastion', 'Bastion', 119, 'Jobs'],
  ['demon-slayer', 'Demon Slayer', 125, 'Jobs'],
  ['colossus', 'Colossus', 133, 'Jobs'],
  ['knave', 'Knave', 139, 'Jobs'],
  ['vagabond', 'Vagabond', 145, 'Jobs'],
  ['fool', 'Fool', 147, 'Jobs'],
  ['freelancer', 'Freelancer', 153, 'Jobs'],
  ['shade', 'Shade', 159, 'Jobs'],
  ['warden', 'Warden', 166, 'Jobs'],
  ['mendicant', 'Mendicant', 172, 'Jobs'],
  ['chanter', 'Chanter', 174, 'Jobs'],
  ['harvester', 'Harvester', 182, 'Jobs'],
  ['sealer', 'Sealer', 189, 'Jobs'],
  ['seer', 'Seer', 197, 'Jobs'],
  ['wright', 'Wright', 204, 'Jobs'],
  ['enochian', 'Enochian', 206, 'Jobs'],
  ['geomancer', 'Geomancer', 215, 'Jobs'],
  ['spellblade', 'Spellblade', 222, 'Jobs'],
  ['stormbender', 'Stormbender', 230, 'Jobs'],
  ['adventure', 'The Book of Adventure', 237, 'Book of Adventure'],
  ['game-flow', 'Game Flow and Advancement', 238, 'Book of Adventure'],
  ['rewards', 'Rewards and Trophies', 242, 'Book of Adventure'],
  ['relics', 'Relics', 245, 'Book of Adventure'],
  ['camp', 'The Camp', 253, 'Book of Adventure'],
  ['custom-rules', 'Custom Rules', 261, 'Book of Adventure'],
  ['dungeon-crawl', 'Dungeon Crawl', 262, 'Book of Adventure'],
  ['battle-scenarios', 'Battle Scenarios', 270, 'Book of Adventure'],
  ['intrigue', 'Intrigue', 276, 'Book of Adventure'],
  ['trek', 'Trek', 281, 'Book of Adventure'],
  ['foes', 'The Book of Foes', 287, 'Book of Foes'],
  ['foe-rules', 'Foe Rules', 288, 'Book of Foes'],
  ['fight-building', 'Creating Interesting Fights', 294, 'Book of Foes'],
  ['foe-glossary', 'Glossary of Foes', 298, 'Book of Foes'],
  ['basic-jobs', 'Basic Foe Jobs', 300, 'Book of Foes'],
  ['elite', 'Elite Foes', 308, 'Book of Foes'],
  ['basic-legends', 'Basic Legends', 310, 'Book of Foes'],
  ['factions', 'Factions', 314, 'Book of Foes'],
  ['folk-foes', 'Folk', 315, 'Book of Foes'],
  ['relict-foes', 'Relict', 324, 'Book of Foes'],
  ['ruin-beast-foes', 'Ruin Beast', 345, 'Book of Foes'],
  ['scavenger-foes', 'Scavenger', 366, 'Book of Foes'],
  ['imperial-foes', 'Imperial', 387, 'Book of Foes'],
  ['demon-foes', 'Demon', 406, 'Book of Foes'],
  ['lowlander-foes', 'Lowlander', 428, 'Book of Foes'],
  ['jotunn-foes', 'Jotunn', 448, 'Book of Foes'],
  ['hob-foes', 'Hob', 467, 'Book of Foes'],
  ['deeptower', 'Deeptower', 491, 'Adventure'],
];

function normalizePage(items: Array<{ str: string; hasEOL?: boolean }>, pageNumber: number, total: number) {
  let text = '';
  for (const item of items) {
    const value = item.str.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    text += `${text && !text.endsWith('\n') ? ' ' : ''}${value}${item.hasEOL ? '\n' : ''}`;
  }
  return text
    .replace(new RegExp(`\\s*of\\s+${pageNumber}\\s+${total}\\s*$`, 'i'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sectionForPage(page: number) {
  let current = sections[0];
  for (const section of sections) {
    if (section[2] <= page) current = section;
    else break;
  }
  return current;
}

const sourcePath = resolveIconSourcePath(process.argv[2]);
const outputPath = resolve(process.argv[3] ?? 'src/content/generated/icon-1.5.json');
const data = new Uint8Array(await readFile(sourcePath));
assertKnownIconSource(data, sourcePath);
const document = await pdfjs.getDocument({ data }).promise;
if (document.numPages !== EXPECTED_PAGE_COUNT) {
  throw new Error(`ICON 1.5 extraction expected ${EXPECTED_PAGE_COUNT} pages, received ${document.numPages}. Review the source artifact before updating generated catalogs.`);
}
if (sections.length !== EXPECTED_SECTION_COUNT) {
  throw new Error(`ICON 1.5 extraction expected ${EXPECTED_SECTION_COUNT} indexed sections, received ${sections.length}. Review section indexing before continuing.`);
}
const pages = [];

for (let number = 1; number <= document.numPages; number += 1) {
  const page = await document.getPage(number);
  const content = await page.getTextContent();
  const section = sectionForPage(number);
  pages.push({
    number,
    sectionId: section?.[0] ?? 'frontmatter',
    text: normalizePage(content.items as Array<{ str: string; hasEOL?: boolean }>, number, document.numPages),
  });
}

const artifact = {
  schemaVersion: 1,
  metadata: {
    id: 'icon-1.5',
    title: 'ICON',
    subtitle: 'Legacy of the Arkenlords',
    version: '1.5',
    published: '2023-06-07',
    author: 'Tom Bloom',
    attribution: 'Art, layout, and writing by Tom Bloom. Shared with the credits required by the sourcebook.',
    pageCount: document.numPages,
  },
  sections: sections.map(([id, title, startPage, category], index) => ({
    id,
    title,
    category,
    startPage,
    endPage: (sections.slice(index + 1).find((section) => section[2] > startPage)?.[2] ?? document.numPages + 1) - 1,
  })),
  pages,
};

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, 'utf8');
console.log(`Extracted ${document.numPages} pages to ${outputPath}`);
