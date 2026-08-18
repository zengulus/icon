import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextItem {
  str: string;
  fontName: string;
  height: number;
  transform: number[];
}

interface LayoutLine {
  text: string;
  page: number;
  x: number;
  y: number;
  size: number;
  font: string;
  role: FoeRoleId | null;
}

type FoeRoleId = 'mob' | 'heavy' | 'skirmisher' | 'leader' | 'artillery' | 'legend';
type OutputRoleId = FoeRoleId | 'special';
type FoeKind = 'job' | 'variant' | 'unique' | 'elite' | 'legend' | 'component' | 'special';

interface ColorRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: FoeRoleId;
}

interface FoeAbility {
  id: string;
  name: string;
  header: string;
  cost: { kind: 'action' | 'free' | 'interrupt' | 'round' | 'passive'; value: number };
  range: number | null;
  tags: string[];
  rulesText: string;
  phaseId: string | null;
  sourcePage: number;
}

interface FoeTrait {
  id: string;
  name: string;
  rulesText: string;
  phaseId: string | null;
  sourcePage: number;
}

interface FoePhase {
  id: string;
  name: string;
  rulesText: string;
  sourcePage: number;
}

interface FoeChapterRule {
  chapter: 1 | 2 | 3;
  rulesText: string;
  sourcePage: number;
}

interface FoeTrophy {
  id: string;
  name: string;
  uses: { count: number; period: 'use' | 'combat' | 'expedition' };
  rulesText: string;
  sourcePage: number;
}

const factionRanges = [
  ['basic', 300, 313], ['folk', 315, 323], ['relict', 324, 344], ['ruin-beast', 345, 365],
  ['scavenger', 366, 386], ['imperial', 387, 405], ['demon', 406, 427], ['lowlander', 428, 447],
  ['jotunn', 448, 466], ['hob', 467, 490],
] as const;

const roleColors = new Map<string, FoeRoleId>([
  ['#929292', 'mob'],
  ['#ee220c', 'heavy'],
  ['#feae00', 'skirmisher'],
  ['#61d836', 'leader'],
  ['#00a2ff', 'artillery'],
  ['#ca55ef', 'legend'],
]);

const sectionRanges = [
  ['basic-jobs', 300, 307], ['elite', 308, 309], ['basic-legends', 310, 313],
  ['folk-foes', 315, 323], ['relict-foes', 324, 344], ['ruin-beast-foes', 345, 365],
  ['scavenger-foes', 366, 386], ['imperial-foes', 387, 405], ['demon-foes', 406, 427],
  ['lowlander-foes', 428, 447], ['jotunn-foes', 448, 466], ['hob-foes', 467, 490],
] as const;

const slug = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function addText(left: string, right: string) {
  if (!left) return right;
  if (/^[,.;:!?)]/.test(right) || left.endsWith('(') || left.endsWith('[')) return `${left}${right}`;
  return `${left} ${right}`;
}

function extractColorRects(operatorList: { fnArray: number[]; argsArray: unknown[][] }): ColorRect[] {
  const rects: ColorRect[] = [];
  let role: FoeRoleId | null = null;
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];
    if (operation === pdfjs.OPS.setFillRGBColor) role = roleColors.get(String(args[0])) ?? null;
    if (operation !== pdfjs.OPS.constructPath || !role || !args[2]) continue;
    const bounds = args[2] as ArrayLike<number>;
    const [x1, y1, x2, y2] = [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const height = y2 - y1;
    if (x2 - x1 > 10 && height > 8 && height < 50) rects.push({ x1, y1, x2, y2, role });
  }
  return rects;
}

function roleForText(x: number, y: number, rects: ColorRect[]) {
  return rects.find((rect) => x >= rect.x1 - 1 && x <= rect.x2 + 1 && y >= rect.y1 - 2 && y <= rect.y2 + 2)?.role ?? null;
}

function toLines(items: TextItem[], page: number, rects: ColorRect[]): LayoutLine[] {
  const lines: LayoutLine[] = [];
  let current: LayoutLine | null = null;
  let lastX = 0;
  for (const item of items) {
    const text = item.str.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const size = Math.round(item.height * 10) / 10;
    const sameLine = current && Math.abs(current.y - y) < 1 && x >= lastX - 2;
    if (sameLine && current) current.text = addText(current.text, text);
    else {
      current = { text, page, x: Math.round(x), y: Math.round(y), size, font: item.fontName, role: roleForText(x, y, rects) };
      lines.push(current);
    }
    lastX = x;
  }
  const visible = lines.filter((line) => line.y > 55);
  const merged: LayoutLine[] = [];
  for (const line of visible) {
    const previous = merged.at(-1);
    const wrappedHeading = previous?.role && line.role === previous.role
      && line.page === previous.page
      && line.font === previous.font
      && line.size === previous.size
      && Math.abs(line.x - previous.x) <= 4
      && previous.y > line.y
      && previous.y - line.y <= previous.size * 1.7;
    if (wrappedHeading && previous) previous.text = addText(previous.text, line.text);
    else merged.push(line);
  }
  return merged;
}

function parseCost(header: string): FoeAbility['cost'] {
  const interrupt = header.match(/interrupt(?:\s+(\d+))?/i);
  if (interrupt) return { kind: 'interrupt', value: Number(interrupt[1] ?? 1) };
  if (/round action/i.test(header)) return { kind: 'round', value: 0 };
  if (/free action/i.test(header)) return { kind: 'free', value: 0 };
  const action = header.match(/(\d+)\s+actions?/i);
  return action ? { kind: 'action', value: Number(action[1]) } : { kind: 'passive', value: 0 };
}

function abilityStart(body: LayoutLine[], index: number) {
  const line = body[index];
  if (line.size < 9.5 || line.size > 10.5 || !/\(/.test(line.text)) return null;
  let joined = line.text.replace(/^•\s*/, '');
  let consumed = 1;
  while (!/\)/.test(joined) && consumed < 4 && body[index + consumed]?.size <= 10.5) {
    joined = addText(joined, body[index + consumed].text.replace(/^•\s*/, ''));
    consumed += 1;
  }
  const match = joined.match(/^(.{1,70}?)\s*\(([^)]*(?:(?:\d+\s+actions?)|(?:free action)|(?:interrupt(?:\s+\d+)?)|(?:round action))[^)]*)\)\s*[.:]?\s*(.*)$/i);
  if (!match) return null;
  const name = match[1].trim();
  if (/^(?:effect|trigger|special|object effect|summon effect|terrain effect)$/i.test(name)) return null;
  return { name, header: match[2].trim(), remainder: match[3].trim(), consumed };
}

const inlineRuleLabels = /^(?:effect|special(?: effect)?|trigger|on hit|on miss|miss|auto ?hit|area effect|object effect|summon effect|terrain effect|collide|charge|exceed|slay|delay|greed|blessing|imperium|destruction|intervene)$/i;

function traitStart(body: LayoutLine[], index: number) {
  const line = body[index];
  if (line.size < 9.5 || line.size > 10.5 || !line.font.endsWith('f3')) return null;
  const normalized = line.text.replace(/^•\s*/, '').trim();
  const match = normalized.match(/^([^:]{2,80}):\s*(.*)$/);
  if (!match || inlineRuleLabels.test(match[1].trim()) || /^chapter\b/i.test(match[1])) return null;
  if (/\((?:(?:\d+\s+actions?)|(?:free action)|(?:interrupt(?:\s+\d+)?)|(?:round action))[^)]*\)/i.test(normalized)) return null;
  return { name: match[1].trim(), remainder: match[2].trim(), consumed: 1 };
}

function phaseStart(line: LayoutLine) {
  if (!line.font.endsWith('f1') || line.size < 9.5 || line.size > 10.5) return null;
  const match = line.text.match(/^(Phase(?:s|\s+(?:[IVX]+|\d+)))\s*:\s*(.*)$/i);
  return match ? { name: match[1].trim(), remainder: match[2].trim() } : null;
}

function chapterStart(line: LayoutLine) {
  const match = line.text.match(/^Chapter\s+([123])\+?\s*(.*)$/i);
  return match ? { chapter: Number(match[1]) as 1 | 2 | 3, remainder: match[2].trim() } : null;
}

function parseFeatures(profileId: string, sectionId: string, body: LayoutLine[]) {
  const abilities: FoeAbility[] = [];
  const traits: FoeTrait[] = [];
  const phases: FoePhase[] = [];
  const chapterRules: FoeChapterRule[] = [];
  const usedIds = new Map<string, number>();
  let current: FoeAbility | FoeTrait | FoePhase | FoeChapterRule | null = null;
  let currentKind: 'ability' | 'trait' | 'phase' | 'chapter' | null = null;
  let activePhaseId: string | null = null;
  const append = (text: string) => {
    if (current && text) current.rulesText = addText(current.rulesText, text);
  };
  for (let index = 0; index < body.length;) {
    const phase = phaseStart(body[index]);
    if (phase) {
      const id = `${profileId}:phase:${slug(phase.name)}`;
      current = { id, name: phase.name, rulesText: phase.remainder, sourcePage: body[index].page };
      phases.push(current);
      currentKind = 'phase';
      activePhaseId = /^phases$/i.test(phase.name) ? null : id;
      index += 1;
      continue;
    }
    const chapter = chapterStart(body[index]);
    if (chapter) {
      current = { chapter: chapter.chapter, rulesText: chapter.remainder, sourcePage: body[index].page };
      chapterRules.push(current);
      currentKind = 'chapter';
      index += 1;
      continue;
    }
    const start = abilityStart(body, index);
    if (start) {
      const baseId = `${profileId}:${slug(start.name)}`;
      const occurrence = (usedIds.get(baseId) ?? 0) + 1;
      usedIds.set(baseId, occurrence);
      current = {
        id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
        name: start.name,
        header: start.header,
        cost: parseCost(start.header),
        range: Number(start.header.match(/\brange\s+(\d+)/i)?.[1]) || null,
        tags: start.header.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        rulesText: start.remainder,
        phaseId: activePhaseId,
        sourcePage: body[index].page,
      };
      abilities.push(current);
      currentKind = 'ability';
      index += start.consumed;
      continue;
    }
    const trait = traitStart(body, index);
    if (trait) {
      const baseId = `${profileId}:trait:${slug(trait.name)}`;
      const occurrence = (usedIds.get(baseId) ?? 0) + 1;
      usedIds.set(baseId, occurrence);
      current = {
        id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
        name: trait.name,
        rulesText: trait.remainder,
        phaseId: activePhaseId,
        sourcePage: body[index].page,
      };
      traits.push(current);
      currentKind = 'trait';
      index += trait.consumed;
      continue;
    }
    if (currentKind !== null) append(body[index].text);
    index += 1;
  }
  return { abilities, traits, phases, chapterRules, sectionId };
}

function parseTrophies(profileId: string, body: LayoutLine[]): FoeTrophy[] {
  const headingIndex = body.findIndex((line) => line.size >= 13 && /^trophies\b/i.test(line.text));
  if (headingIndex < 0) return [];
  const trophyLines = body.slice(headingIndex + 1);
  const starts = trophyLines.map((line, index) => ({ line, index })).filter(({ line, index }) => {
    if (line.size < 9.5 || line.size > 10.5 || !line.font.endsWith('f3')) return false;
    return trophyLines.slice(index + 1, index + 4).some((candidate) => /^uses?\s*:/i.test(candidate.text));
  });
  return starts.map(({ line, index }, trophyIndex) => {
    const end = starts[trophyIndex + 1]?.index ?? trophyLines.length;
    const entry = trophyLines.slice(index + 1, end);
    const usesIndex = entry.findIndex((candidate) => /^uses?\s*:/i.test(candidate.text));
    const usesText = usesIndex >= 0 ? entry[usesIndex].text : '1';
    const count = Number(usesText.match(/\b(\d+)\b/)?.[1] ?? 1);
    const period = /expedition/i.test(usesText) ? 'expedition' : /combat/i.test(usesText) ? 'combat' : 'use';
    const rulesText = entry.slice(usesIndex + 1).map((candidate) => candidate.text).join(' ').replace(/\s+/g, ' ').replace(/^Effect\s*:\s*/i, '').trim();
    return {
      id: `${profileId}:trophy:${slug(line.text)}`,
      name: line.text.trim(),
      uses: { count, period },
      rulesText,
      sourcePage: line.page,
    };
  });
}

const sourcePath = resolve(process.argv[2] ?? 'ICON 1.5.pdf');
const outputPath = resolve(process.argv[3] ?? 'src/content/generated/foes-1.5.json');
const data = new Uint8Array(await readFile(sourcePath));
const document = await pdfjs.getDocument({ data }).promise;
const lines: LayoutLine[] = [];
for (let pageNumber = 300; pageNumber <= 490; pageNumber += 1) {
  const page = await document.getPage(pageNumber);
  const [content, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const items = content.items.filter((item) => 'str' in item) as unknown as TextItem[];
  lines.push(...toLines(items, pageNumber, extractColorRects(operatorList as never)));
}

const boundaries = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.role && line.size >= 11.5 && line.text.length <= 100);
const profiles = [];
let currentKind: Exclude<FoeKind, 'variant' | 'component'> = 'job';
let currentLegendId: string | null = null;
const currentJobByRole = new Map<FoeRoleId, string>();
for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
  const { line: heading, index: start } = boundaries[boundaryIndex];
  const displayName = heading.text.replace(/^\d+\.\s*/, '').trim();
  const normalizedHeading = displayName.toLocaleLowerCase();
  const faction = factionRanges.find(([, first, last]) => heading.page >= first && heading.page <= last)?.[0] ?? 'unknown';

  if (/^(?:basic jobs?|foes)$/.test(normalizedHeading)) {
    currentKind = faction === 'folk' ? 'unique' : 'job';
    currentLegendId = null;
    currentJobByRole.clear();
    continue;
  }
  if (/^(?:unique elites?|elite)$/.test(normalizedHeading)) {
    currentKind = 'elite';
    currentLegendId = null;
    continue;
  }
  if (/^(?:basic legends?|unique legends?|legends?)$/.test(normalizedHeading)) {
    currentKind = 'legend';
    currentLegendId = null;
    continue;
  }
  if (/^uniques?$/.test(normalizedHeading)) {
    currentKind = 'unique';
    currentLegendId = null;
    continue;
  }
  if (/^(?:[ivx]+\.\s*)?(?:folk|relict|ruin beast|scavenger|imperial|demon|lowlander|jotunn|hob)$/.test(normalizedHeading)) {
    currentKind = faction === 'folk' ? 'unique' : 'job';
    currentLegendId = null;
    currentJobByRole.clear();
    continue;
  }

  const end = boundaries[boundaryIndex + 1]?.index ?? lines.length;
  const rawBody = lines.slice(start + 1, end);
  const terminalHeading = rawBody.findIndex((line) => line.size >= 13 && /^(?:tactics|trophies)\b/i.test(line.text));
  const body = terminalHeading < 0 ? rawBody : rawBody.slice(0, terminalHeading);
  const profileId = `${faction}:${slug(displayName)}:${heading.page}`;
  if (/^(?:template|faction template|special mechanic|special template|unique mob|chapter\b|trophies?\b|.* trophies$|glossary|phases?|faction mechanic)\b/i.test(displayName)) continue;
  if (/^(?:mob|heavy|skirmisher|leader|artillery)$/.test(normalizedHeading)) continue;
  const sectionId = sectionRanges.find(([, first, last]) => heading.page >= first && heading.page <= last)?.[0] ?? 'foes';
  const features = parseFeatures(profileId, sectionId, body);
  const trophies = parseTrophies(profileId, rawBody);
  if (features.abilities.length === 0 && features.traits.length === 0 && heading.role === 'legend' && currentKind !== 'legend') continue;
  const firstMechanicalLine = body.findIndex((line, index) => Boolean(abilityStart(body, index) || traitStart(body, index) || phaseStart(line) || chapterStart(line)));
  const prelude = firstMechanicalLine < 0 ? body : body.slice(0, firstMechanicalLine);
  const description = prelude.filter((item) => item.font.endsWith('f4')).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
  const traitsText = features.traits.map((trait) => `${trait.name}: ${trait.rulesText}`).join(' ').replace(/\s+/g, ' ').trim();
  const bodyText = body.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
  const statNumber = (label: string) => Number(bodyText.match(new RegExp(`\\b(?:${label})\\s*:\\s*(\\d+)`, 'i'))?.[1]) || undefined;
  const damageDie = Number(bodyText.match(/(?:\[D\]|Damage(?: die)?|\bD)\s*:\s*(?:1)?d(6|8|10)\b/i)?.[1]) || undefined;
  const stats = {
    vitality: statNumber('Vitality|VIT'),
    hp: statNumber('HP'),
    speed: statNumber('Speed'),
    dash: Number(bodyText.match(/\bDash\s+(\d+)\b/i)?.[1]) || undefined,
    defense: statNumber('Defense'),
    armor: statNumber('Armor'),
    fray: statNumber('Fray(?: damage)?'),
    damageDie: damageDie as 6 | 8 | 10 | undefined,
    size: statNumber('Size'),
  };

  let roleId: OutputRoleId = heading.role!;
  let kind: FoeKind = currentKind;
  let parentId: string | null = null;
  if (currentKind === 'legend') {
    const startsLegend = !currentLegendId || /\bLegend\s*:/i.test(traitsText) || /takes 1 turn for each player/i.test(traitsText);
    if (startsLegend) currentLegendId = profileId;
    else {
      kind = 'component';
      parentId = currentLegendId;
    }
  } else if (heading.role === 'legend') {
    roleId = 'special';
    kind = 'special';
  } else if (currentKind === 'job' && faction !== 'basic') {
    const baseJobId = currentJobByRole.get(heading.role!);
    if (heading.size < 17 && baseJobId) {
      kind = 'variant';
      parentId = baseJobId;
    } else currentJobByRole.set(heading.role!, profileId);
  }

  profiles.push({
    id: profileId,
    name: displayName,
    faction,
    roleId,
    kind,
    parentId,
    source: { page: heading.page, sectionId },
    description,
    traitsText,
    traits: features.traits.map((trait) => ({
      ...trait,
      source: { page: trait.sourcePage, sectionId },
      sourcePage: undefined,
      automation: 'structured',
    })),
    phases: features.phases.map((phase) => ({
      ...phase,
      source: { page: phase.sourcePage, sectionId },
      sourcePage: undefined,
    })),
    chapterRules: features.chapterRules.map((rule) => ({
      ...rule,
      source: { page: rule.sourcePage, sectionId },
      sourcePage: undefined,
    })),
    minimumChapter: features.chapterRules.length ? Math.min(...features.chapterRules.map(({ chapter }) => chapter)) : 1,
    stats: Object.fromEntries(Object.entries(stats).filter(([, value]) => value !== undefined)),
    trophies: trophies.map((trophy) => ({
      ...trophy,
      source: { page: trophy.sourcePage, sectionId },
      sourcePage: undefined,
      automation: 'structured',
    })),
    abilities: features.abilities.map((ability) => ({
      ...ability,
      source: { page: ability.sourcePage, sectionId },
      sourcePage: undefined,
    })),
    automation: 'structured',
  });
}

const uniqueProfiles = [...new Map(profiles.map((profile) => [profile.id, profile])).values()];
const artifact = {
  schemaVersion: 2,
  rulesVersion: '1.5',
  profiles: uniqueProfiles,
  counts: {
    profiles: uniqueProfiles.length,
    abilities: uniqueProfiles.reduce((sum, profile) => sum + profile.abilities.length, 0),
    traits: uniqueProfiles.reduce((sum, profile) => sum + profile.traits.length, 0),
    trophies: uniqueProfiles.reduce((sum, profile) => sum + profile.trophies.length, 0),
    byKind: Object.fromEntries(['job', 'variant', 'unique', 'elite', 'legend', 'component', 'special'].map((kind) => [kind, uniqueProfiles.filter((profile) => profile.kind === kind).length])),
    byRole: Object.fromEntries(['mob', 'heavy', 'skirmisher', 'leader', 'artillery', 'legend', 'special'].map((role) => [role, uniqueProfiles.filter((profile) => profile.roleId === role).length])),
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, 'utf8');
console.log(`Extracted ${artifact.counts.profiles} foe profiles and ${artifact.counts.abilities} foe abilities to ${outputPath}`);
