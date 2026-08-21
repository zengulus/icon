import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextItem {
  str: string;
  fontName: string;
  height: number;
  transform: number[];
}

interface PositionedText {
  text: string;
  font: string;
  size: number;
  x: number;
  y: number;
  page: number;
  order: number;
}

interface LayoutLine extends PositionedText {}

const trophyNames = [
  'Frost enchantment', 'Flame enchantment', 'Lightning enchantment', 'Poison enchantment', 'Gnarled horn',
  'Displacement Cloak', 'Boots of Speed', 'Valkyrie’s Mantle', 'Crystal Skull', 'Whisper Cloak',
  'Stave of Flame', 'Helm of the Ram', 'Phase Shard', 'Gangariant’s Stave', 'Broken Key to Numenea',
  'Jotunn Mead', 'Axe of Mork', 'Warding Armor', 'Tears of the Weeper', 'Fragment of the Ur-Spell',
] as const;

const fixtureNames = [
  'Aetherpearls', 'Aethervault', 'Cabinet', 'Cauldron', 'Cooking Pot', 'Campfire', 'Elixir Stone',
  'Fishing Pole', 'Forge', 'Liftstone', 'Portable Library', 'Kapkat Table', 'Shrine', 'Spirit Idol',
  'Survival Gear', 'Thieves’ Gear',
] as const;

const slug = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function addText(left: string, right: string) {
  if (!left) return right;
  if (/^[,.;:!?)]/.test(right) || left.endsWith('(') || left.endsWith('[')) return `${left}${right}`;
  return `${left} ${right}`;
}

function toLines(items: PositionedText[]) {
  const lines: LayoutLine[] = [];
  for (const item of items) {
    const current = lines.at(-1);
    const sameLine = current && current.page === item.page && Math.abs(current.y - item.y) <= 1 && item.x >= current.x - 2;
    if (sameLine && current) current.text = addText(current.text, item.text);
    else lines.push({ ...item });
  }
  return lines;
}

const sourcePath = resolve(process.argv[2] ?? 'ICON 1.5.pdf');
const outputPath = resolve(process.argv[3] ?? 'src/content/generated/rewards-1.5.json');
const data = new Uint8Array(await readFile(sourcePath));
const document = await pdfjs.getDocument({ data }).promise;
const positioned: PositionedText[] = [];
let order = 0;
for (const pageNumber of [...Array.from({ length: 19 }, (_, index) => index + 242)]) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  for (const item of content.items.filter((candidate) => 'str' in candidate) as unknown as TextItem[]) {
    const text = item.str.replace(/\s+/g, ' ').trim();
    if (!text || item.transform[5] <= 55) continue;
    positioned.push({
      text,
      font: item.fontName,
      size: Math.round(item.height * 10) / 10,
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      page: pageNumber,
      order: order++,
    });
  }
}

const trophyItems = positioned.filter(({ page }) => page === 243 || page === 244);
const numberMarkers = trophyItems.filter(({ text, x }) => /^\d{1,2}$/.test(text) && x >= 88 && x <= 105)
  .map((item) => ({ ...item, number: Number(item.text) }))
  .filter(({ number }) => number >= 1 && number <= 20)
  .sort((left, right) => left.number - right.number);

const generalTrophies = numberMarkers.map((marker, index) => {
  const next = numberMarkers[index + 1];
  const row = trophyItems.filter((item) => item.order >= marker.order && item.order < (next?.order ?? Number.POSITIVE_INFINITY));
  const joinColumn = (minimum: number, maximum: number) => row.filter(({ x }) => x >= minimum && x < maximum)
    .sort((left, right) => right.y - left.y || left.x - right.x)
    .reduce((text, item) => addText(text, item.text), '');
  const extractedName = joinColumn(110, 230).replace(/\s+-\s+/g, '-').trim();
  const rulesText = joinColumn(230, 470).trim();
  const usesText = joinColumn(470, 560).trim();
  const period = /expedition/i.test(usesText) ? 'expedition' : /combat/i.test(usesText) ? 'combat' : 'use';
  return {
    id: `general:${slug(trophyNames[index])}`,
    name: trophyNames[index],
    tableRoll: marker.number,
    uses: { count: Number(usesText.match(/\d+/)?.[0] ?? 1), period },
    rulesText,
    extractedName,
    source: { page: marker.page, sectionId: 'rewards' },
    automation: 'structured',
  };
});

const fixtureItems = positioned.filter(({ page }) => page >= 254 && page <= 260);
const fixtureStarts = fixtureNames.map((name) => {
  const item = fixtureItems.find((candidate) => candidate.text.toLocaleLowerCase() === name.toLocaleLowerCase() && candidate.size >= 11.5);
  if (!item) throw new Error(`Could not locate camp fixture: ${name}`);
  return { name, item };
}).sort((left, right) => left.item.order - right.item.order);

const fixtures = fixtureStarts.map(({ name, item }, fixtureIndex) => {
  const endOrder = fixtureStarts[fixtureIndex + 1]?.item.order ?? Number.POSITIVE_INFINITY;
  const bodyItems = fixtureItems.filter((candidate) => candidate.order > item.order && candidate.order < endOrder);
  const bodyLines = toLines(bodyItems);
  const rulesText = bodyLines.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
  const featureStarts = bodyLines.map((line, index) => ({ line, index })).filter(({ line }) => {
    const match = line.text.match(/^•?\s*([^:]{2,90}):/);
    const startsAsFeature = line.text.trimStart().startsWith('•') || line.font.endsWith('f2');
    return Boolean(startsAsFeature && match && !/^(?:purchase|upgrade|upgrades)$/i.test(match[1].trim()));
  });
  const featureIds = new Map<string, number>();
  const features = featureStarts.map(({ line, index }, featureIndex) => {
    const match = line.text.match(/^•?\s*([^:]{2,90}):\s*(.*)$/)!;
    const end = featureStarts[featureIndex + 1]?.index ?? bodyLines.length;
    const trailing = bodyLines.slice(index + 1, end).map((candidate) => candidate.text).join(' ');
    const baseId = `camp:${slug(name)}:${slug(match[1])}`;
    const occurrence = (featureIds.get(baseId) ?? 0) + 1;
    featureIds.set(baseId, occurrence);
    return {
      id: occurrence === 1 ? baseId : `${baseId}:${occurrence}`,
      name: match[1].trim(),
      rulesText: addText(match[2].trim(), trailing).replace(/\s+/g, ' ').trim(),
      source: { page: line.page, sectionId: 'camp' },
      automation: 'structured',
    };
  });
  return {
    id: `camp:${slug(name)}`,
    name,
    purchaseCost: Number(rulesText.match(/Purchase\s*:\s*(\d+)\s*dust/i)?.[1] ?? 0),
    upgradeCost: Number(rulesText.match(/Upgrade\s*:?\s*(\d+)\s*dust/i)?.[1] ?? 0),
    rulesText,
    features,
    source: { page: item.page, sectionId: 'camp' },
    automation: 'structured',
  };
});

const artifact = {
  schemaVersion: 1,
  rulesVersion: '1.5',
  generalTrophies,
  fixtures,
  counts: {
    generalTrophies: generalTrophies.length,
    fixtures: fixtures.length,
    fixtureFeatures: fixtures.reduce((sum, fixture) => sum + fixture.features.length, 0),
  },
};

if (artifact.counts.generalTrophies !== 20 || artifact.counts.fixtures !== 16 || artifact.counts.fixtureFeatures !== 87) {
  throw new Error(`ICON 1.5 rewards extraction expected 20 trophies, 16 camp fixtures, and 87 features; received ${artifact.counts.generalTrophies}, ${artifact.counts.fixtures}, and ${artifact.counts.fixtureFeatures}. Review the source artifact or parser before publishing generated data.`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, 'utf8');
console.log(`Extracted ${artifact.counts.generalTrophies} general trophies and ${artifact.counts.fixtures} camp fixtures to ${outputPath}`);
