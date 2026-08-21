import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextItem {
  str: string;
  fontName: string;
  height: number;
  transform: number[];
  hasEOL: boolean;
}

interface LayoutLine {
  text: string;
  page: number;
  x: number;
  y: number;
  size: number;
  font: string;
}

interface ParsedAbility {
  id: string;
  name: string;
  jobId: string;
  classId: string;
  chapter: number;
  sourcePage: number;
  cost: { kind: 'action' | 'free' | 'interrupt' | 'passive'; value: number };
  range: number | null;
  tags: string[];
  header: string;
  summary: string;
  rulesText: string;
  talents: [string, string] | [];
  mastery: { name: string; text: string } | null;
}

interface ParsedRelic {
  id: string;
  name: string;
  sourcePage: number;
  description: string;
  ranks: [string, string, string];
  aspect: string;
  aspectQuest: string;
}

interface ParsedLimitBreak {
  id: string;
  name: string;
  resolveCost: number;
  cost: { kind: 'action' | 'free'; value: number };
  range: number | null;
  tags: string[];
  rulesText: string;
}

interface ParsedTrait {
  id: string;
  name: string;
  sourcePage: number;
  rulesText: string;
}

interface ParsedBond {
  id: string;
  name: string;
  sourcePage: number;
  summary: string;
  ideals: string[];
  effort: number;
  strain: number;
  secondWind: string;
  specialAbility: string;
  kits: Array<{ name: string; itemsText: string }>;
  powers: Array<{ name: string; rulesText: string }>;
}

const bondSeeds = [
  ['pathfinder', 'Pathfinder', 56], ['seeker', 'Seeker', 58], ['mighty', 'Mighty', 60], ['wolf', 'Wolf', 62],
  ['harlequin', 'Harlequin', 64], ['highborn', 'Highborn', 66], ['mender', 'Mender', 68], ['brave', 'Brave', 70],
  ['broker', 'Broker', 72], ['elder', 'Elder', 74], ['outsider', 'Outsider', 76], ['dreamer', 'Dreamer', 78],
] as const;

const jobSeeds = [
  ['bastion', 'Bastion', 'stalwart', 119, 124],
  ['demon-slayer', 'Demon Slayer', 'stalwart', 125, 132],
  ['colossus', 'Colossus', 'stalwart', 133, 138],
  ['knave', 'Knave', 'stalwart', 139, 144],
  ['fool', 'Fool', 'vagabond', 147, 152],
  ['freelancer', 'Freelancer', 'vagabond', 153, 158],
  ['shade', 'Shade', 'vagabond', 159, 165],
  ['warden', 'Warden', 'vagabond', 166, 171],
  ['chanter', 'Chanter', 'mendicant', 174, 181],
  ['harvester', 'Harvester', 'mendicant', 182, 188],
  ['sealer', 'Sealer', 'mendicant', 189, 196],
  ['seer', 'Seer', 'mendicant', 197, 203],
  ['enochian', 'Enochian', 'wright', 206, 214],
  ['geomancer', 'Geomancer', 'wright', 215, 221],
  ['spellblade', 'Spellblade', 'wright', 222, 229],
  ['stormbender', 'Stormbender', 'wright', 230, 236],
] as const;

const EXPECTED_COUNTS = { jobs: 16, abilities: 144, relics: 40, bonds: 12 } as const;

const jobTraitNames: Record<string, readonly string[]> = {
  bastion: ['Strive', 'Press the Advantage', 'Bull’s Strength', 'Shieldmaster'],
  'demon-slayer': ['Demon Edge', 'Demon Strength', 'Hissatsu', 'True Horn'],
  colossus: ['Furious Berserk', 'Wolfheart', 'Pulverize', 'Great Leap'],
  knave: ['Martial Master', 'Blackheart', 'Taunt', 'Spite'],
  fool: ['Tumbling', 'Curse of Chaos', 'Cheap Trick', 'Stack Dice'],
  freelancer: ['Bound Spirit', 'Aether Shot', 'Trigrammaton', 'Astral Binding'],
  shade: ['Shadow Arts', 'Underworld', 'Darkside', 'Meld'],
  warden: ['Beast Master', 'Path of the Aesi', 'Ambush master', 'Green Kenning'],
  chanter: ['Blessing of Faith', 'Songweave', 'Divine Grace', 'Uplift'],
  harvester: ['Blessing of Rebirth', 'Mark of Tsumi', 'Gardener of Kin', 'Balance'],
  sealer: ['Blessing of War', 'Mantra of Sealing', 'Godly Smite', 'Martial Arts'],
  seer: ['The Wheel of Fate', 'Skein', 'Foretell', 'Bend Fate', 'Karma'],
  enochian: ['Inner Furnace', 'Embersoul', 'Phoenix Rage', 'Soulfire'],
  geomancer: ['Aftershock', 'Resonance', 'Orogenic Rage', 'Stone Double'],
  spellblade: ['Aether Deflection', 'Conqueror’s Edge', 'Storm Hilt Rage', 'Klingenkunst'],
  stormbender: ['Selkie', 'Dash on the Rocks', 'Sea Legs', 'Pelagic Rage'],
};

const knownTags = [
  'attack', 'auto hit', 'true strike', 'pierce', 'divine', 'unerring', 'combo', 'stance', 'aura', 'mark', 'multimark', 'summon',
  'terrain effect', 'end turn', 'delay', 'rebound', 'line', 'arc', 'burst', 'small blast', 'medium blast',
  'large blast', 'self', 'ally', 'foe', 'character', 'object', 'space', 'range', 'sacrifice', 'power die',
  'heroic', 'charge', 'exceed', 'collide', 'comeback', 'finishing blow', 'slay', 'chain reaction', 'infuse', 'gamble',
];

const slug = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function addText(left: string, right: string) {
  if (!left) return right;
  if (/^[,.;:!?)]/.test(right) || left.endsWith('(') || left.endsWith('[')) return `${left}${right}`;
  return `${left} ${right}`;
}

function toLines(items: TextItem[], page: number): LayoutLine[] {
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
      current = { text, page, x: Math.round(x), y: Math.round(y), size, font: item.fontName };
      lines.push(current);
    }
    lastX = x;
  }
  return lines.filter((line) => line.y > 55);
}

function isAbilityHeading(line: LayoutLine) {
  const value = line.text.trim();
  return line.size >= 11.5 && line.size <= 12.5 && value.length >= 3 && value === value.toLocaleUpperCase() && /^[\p{Lu}\p{N}][\p{Lu}\p{N} ’'\-]+$/u.test(value);
}

function isMechanicalHeaderLine(value: string) {
  const text = value.trim();
  if (/^(?:\d+\s+actions?|free action|interrupt\s+\d+)\b/i.test(text)) return true;
  const pieces = text.split(',').map((piece) => piece.trim()).filter(Boolean);
  return pieces.length > 0 && pieces.every((piece) =>
    /^(?:attack|true strike|pierce|unerring|combo|stance|aura(?:\s+\d+)?|mark|multimark|summon|terrain effect|end turn|delay|rebound|self|ally|foe|characters?|objects?|spaces?|melee|sacrifice|power die|gamble|\+\d+\s+(?:boon|curse)|range\s+\d+|line\s+\d+|arc\s+\d+|burst\s+\d+(?:\s+\([^)]+\))?|(?:small|medium|large)\s+blast)$/i.test(piece),
  );
}

function parseCost(header: string): ParsedAbility['cost'] {
  const interrupt = header.match(/interrupt\s+(\d+)/i);
  if (interrupt) return { kind: 'interrupt', value: Number(interrupt[1]) };
  if (/free action/i.test(header)) return { kind: 'free', value: 0 };
  const action = header.match(/(\d+)\s+actions?/i);
  if (action) return { kind: 'action', value: Number(action[1]) };
  return { kind: 'passive', value: 0 };
}

function parseAbility(jobId: string, classId: string, chapter: number, heading: LayoutLine, body: LayoutLine[]): ParsedAbility {
  const text = body.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
  const talentIndex = text.search(/\bTalents?:?(?=\s+I\.)/i);
  const masteryIndex = text.search(/\bMastery:/i);
  const baseEnd = [talentIndex, masteryIndex].filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? text.length;
  const baseText = text.slice(0, baseEnd).trim();
  const headerLines: string[] = [];
  const summaryLines: string[] = [];
  let headerDone = false;
  for (const line of body) {
    if (!headerDone && isMechanicalHeaderLine(line.text)) {
      headerLines.push(line.text);
      continue;
    }
    headerDone = true;
    if (/^(Attack|Effect|Area effect|Stance|Trigger|Summon effect|Terrain effect|Delay|Heroic|Charge|Collide|Exceed|Comeback|Finishing Blow|Slay|Infuse|Gamble|Talents?|Mastery):?/i.test(line.text)) break;
    summaryLines.push(line.text);
  }
  const header = headerLines.join(', ').replace(/,\s*,/g, ',').trim();
  const summary = summaryLines.join(' ').replace(/\s+/g, ' ').trim();
  const range = header.match(/\brange\s+(\d+)/i) ?? baseText.slice(0, 160).match(/\brange\s+(\d+)/i);
  const normalizedHeader = header.toLocaleLowerCase();
  const tags = knownTags.filter((tag) => new RegExp(`\\b${tag.replace(' ', '\\s+')}\\b`, 'i').test(normalizedHeader));

  let talents: [string, string] | [] = [];
  if (talentIndex >= 0) {
    const talentEnd = masteryIndex > talentIndex ? masteryIndex : text.length;
    const talentText = text.slice(talentIndex + text.slice(talentIndex).match(/Talents?:?/i)![0].length, talentEnd).trim();
    const match = talentText.match(/(?:^|\s)I\.\s+([\s\S]*?)(?:\s+II\.\s+)([\s\S]*)/);
    if (match) talents = [match[1].trim(), match[2].trim()];
  }
  let mastery: ParsedAbility['mastery'] = null;
  if (masteryIndex >= 0) {
    const value = text.slice(masteryIndex).replace(/^Mastery:\s*/i, '');
    const nameMatch = value.match(/^([A-Z0-9][A-Z0-9 ’'\-]+?)(?=\s+[A-Z][a-z]|$)/);
    mastery = { name: nameMatch?.[1]?.trim() ?? 'Mastery', text: value.slice(nameMatch?.[0].length ?? 0).trim() };
  }

  return {
    id: `${jobId}:${slug(heading.text)}`,
    name: heading.text.toLocaleLowerCase().replace(/(^|\s|[-’'])\p{L}/gu, (value) => value.toLocaleUpperCase()),
    jobId,
    classId,
    chapter,
    sourcePage: heading.page,
    cost: parseCost(header),
    range: range ? Number(range[1]) : null,
    tags,
    header,
    summary,
    rulesText: baseText,
    talents,
    mastery,
  };
}

function parseJob(lines: LayoutLine[], seed: typeof jobSeeds[number]) {
  const [id, name, classId, startPage, endPage] = seed;
  const relevant = lines.filter((line) => line.page >= startPage && line.page <= endPage);
  const abilityStart = relevant.findIndex((line) => /^Abilities:?$/i.test(line.text));
  const abilityLines = abilityStart >= 0 ? relevant.slice(abilityStart + 1) : [];
  const abilities: ParsedAbility[] = [];
  let chapter = 1;
  let heading: LayoutLine | null = null;
  let body: LayoutLine[] = [];
  const flush = () => {
    if (heading) abilities.push(parseAbility(id, classId, chapter, heading, body));
    heading = null;
    body = [];
  };
  for (const line of abilityLines) {
    const chapterMatch = line.text.match(/^Chapter\s+([123])\b/i);
    if (chapterMatch) {
      flush();
      chapter = Number(chapterMatch[1]);
      continue;
    }
    if (isAbilityHeading(line)) {
      flush();
      heading = line;
    } else if (heading) body.push(line);
  }
  flush();

  const preludeLines = relevant.slice(0, abilityStart >= 0 ? abilityStart : relevant.length);
  const traitsLineIndex = preludeLines.findIndex((line) => /^traits?:?(?:\s|$)/i.test(line.text));
  const limitLineIndex = preludeLines.findIndex((line) => /^limit break:/i.test(line.text));
  const summonLineIndex = preludeLines.findIndex((line, index) => index > limitLineIndex && /^summons\b/i.test(line.text));
  const joinLines = (values: LayoutLine[]) => values.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
  const traitsText = traitsLineIndex >= 0
    ? joinLines(preludeLines.slice(traitsLineIndex, limitLineIndex > traitsLineIndex ? limitLineIndex : undefined))
    : '';
  const traitNames = jobTraitNames[id] ?? [];
  const traitMatches = traitNames.map((traitName) => {
    const expression = new RegExp(`${traitName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\([^)]*\\))?\\s*:`, 'i');
    const match = expression.exec(traitsText);
    return match ? { name: traitName, index: match.index, bodyStart: match.index + match[0].length } : null;
  }).filter((value): value is NonNullable<typeof value> => value !== null).sort((left, right) => left.index - right.index);
  const traits: ParsedTrait[] = traitMatches.map((match, index) => {
    const sourceLine = preludeLines.find((line) => new RegExp(`^${match.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line.text));
    return {
      id: `${id}:trait:${slug(match.name)}`,
      name: match.name,
      sourcePage: sourceLine?.page ?? startPage,
      rulesText: traitsText.slice(match.bodyStart, traitMatches[index + 1]?.index ?? traitsText.length).trim(),
    };
  });
  const limitText = limitLineIndex >= 0
    ? joinLines(preludeLines.slice(limitLineIndex, summonLineIndex > limitLineIndex ? summonLineIndex : undefined))
    : '';
  const summonRulesText = summonLineIndex >= 0 ? joinLines(preludeLines.slice(summonLineIndex)) : '';
  const limitName = limitText.match(
    /^LIMIT BREAK:\s*(.*?)(?=\s+(?:(?:\d+\s+resolve)|(?:\d+\s+actions?)|(?:free\s+action)|(?:interrupt\s+\d+)))/i,
  )?.[1].trim() ?? '';
  let limitBreak: ParsedLimitBreak | null = null;
  if (limitText) {
    const action = limitText.match(/\b(\d+)\s+actions?\b/i);
    const tagWindow = limitText.slice(0, 220).toLocaleLowerCase();
    limitBreak = {
      id: `${id}:limit-break`,
      name: limitName,
      resolveCost: Number(limitText.match(/\b(\d+)\s+resolve\b/i)?.[1] ?? 0),
      cost: /\bfree\s+action\b/i.test(tagWindow)
        ? { kind: 'free', value: 0 }
        : { kind: 'action', value: Number(action?.[1] ?? 0) },
      range: Number(limitText.match(/\brange\s+(\d+)\b/i)?.[1]) || null,
      tags: knownTags.filter((tag) => new RegExp(`\\b${tag.replace(' ', '\\s+')}\\b`, 'i').test(tagWindow)),
      rulesText: limitText,
    };
  }
  return {
    id,
    name,
    classId,
    sourcePage: startPage,
    endPage,
    traitsText,
    traits,
    summonRulesText,
    limitBreak,
    abilities,
  };
}

function parseRelics(lines: LayoutLine[]): ParsedRelic[] {
  const relevant = lines.filter((line) => line.page >= 245 && line.page <= 252);
  const relics: ParsedRelic[] = [];
  let heading: LayoutLine | null = null;
  let body: LayoutLine[] = [];
  const flush = () => {
    if (!heading) return;
    const sections = { description: [] as string[], one: [] as string[], two: [] as string[], three: [] as string[], aspect: [] as string[], quest: [] as string[] };
    let current: keyof typeof sections = 'description';
    for (const line of body) {
      const marker = line.text.match(/^(I{1,3})\.\s*(.*)$/);
      if (marker) {
        current = marker[1] === 'I' ? 'one' : marker[1] === 'II' ? 'two' : 'three';
        if (marker[2]) sections[current].push(marker[2]);
        continue;
      }
      const aspect = line.text.match(/^A\s*spected\s*:\s*(.*)$/i);
      if (aspect) {
        current = 'aspect';
        if (aspect[1]) sections.aspect.push(aspect[1]);
        continue;
      }
      const quest = line.text.match(/^Aspect quest\s*:\s*(.*)$/i);
      if (quest) {
        current = 'quest';
        if (quest[1]) sections.quest.push(quest[1]);
        continue;
      }
      sections[current].push(line.text);
    }
    const joined = (values: string[]) => values.join(' ').replace(/\s+/g, ' ').trim();
    relics.push({
      id: slug(heading.text),
      name: heading.text.toLocaleLowerCase().replace(/(^|\s|[-’'])\p{L}/gu, (value) => value.toLocaleUpperCase()),
      sourcePage: heading.page,
      description: joined(sections.description),
      ranks: [joined(sections.one), joined(sections.two), joined(sections.three)],
      aspect: joined(sections.aspect),
      aspectQuest: joined(sections.quest),
    });
    heading = null;
    body = [];
  };
  for (const line of relevant) {
    const relicHeading = line.size >= 11.5 && line.size <= 12.5 && line.text !== 'RELICS' && line.text === line.text.toLocaleUpperCase() && /^[\p{Lu}][\p{Lu} ’'\-]+$/u.test(line.text);
    if (relicHeading) {
      flush();
      heading = line;
    } else if (heading) body.push(line);
  }
  flush();
  return relics;
}

function parseBonds(lines: LayoutLine[]): ParsedBond[] {
  return bondSeeds.map(([id, name, sourcePage]) => {
    const profile = lines.filter((line) => line.page === sourcePage);
    const left = profile.filter((line) => line.x < 300);
    const rightText = profile.filter((line) => line.x >= 300).map((line) => line.text).join(' ').replace(/\s+/g, ' ');
    const titleIndex = left.findIndex((line) => line.size >= 17);
    const actionIndex = left.findIndex((line) => /^\+2\b/.test(line.text));
    const summary = left.slice(titleIndex + 1, actionIndex).map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
    const idealsStart = left.findIndex((line) => /^Ideals$/i.test(line.text));
    const gearStart = left.findIndex((line) => /^GEAR$/i.test(line.text));
    const idealLines = left.slice(idealsStart + 1, gearStart);
    const ideals: string[] = [];
    for (const line of idealLines) {
      const idealStart = line.text.match(/^-\s*(.*)$/);
      if (idealStart) ideals.push(idealStart[1]);
      else if (ideals.length) ideals[ideals.length - 1] = addText(ideals[ideals.length - 1], line.text);
    }

    const kits: ParsedBond['kits'] = [];
    let currentKit: ParsedBond['kits'][number] | null = null;
    for (const line of left.slice(gearStart + 1)) {
      if (/^Loose gear\b/i.test(line.text)) break;
      const normalized = line.text.replace(/^•\s*/, '');
      const kitMatch = normalized.match(/^(.+?\bkit)\b\s*:?[\s]*(.*)$/i);
      if (kitMatch) {
        if (/custom kit/i.test(kitMatch[1])) { currentKit = null; continue; }
        currentKit = { name: kitMatch[1].trim(), itemsText: kitMatch[2].trim() };
        kits.push(currentKit);
      } else if (currentKit && line.text !== '•') currentKit.itemsText = addText(currentKit.itemsText, line.text);
    }
    for (const kit of kits) kit.itemsText = kit.itemsText.replace(/^\(/, '').replace(/\)$/, '').trim();

    const powers: ParsedBond['powers'] = [];
    const powerLines = lines.filter((line) => line.page === sourcePage + 1);
    let currentPower: ParsedBond['powers'][number] | null = null;
    for (const line of powerLines) {
      const topLevel = line.text.startsWith('•') && ((line.x >= 70 && line.x <= 82) || (line.x >= 318 && line.x <= 330));
      if (topLevel) {
        const content = line.text.replace(/^•\s*/, '');
        if (/^Gambit\b/i.test(content)) { currentPower = null; continue; }
        const match = content.match(/^(.+?)(?:\s+-\s+|\s*:\s+)(.*)$/);
        if (!match) { currentPower = null; continue; }
        if (/^I{1,3}$/i.test(match[1].trim())) continue;
        const session = match[1].match(/\((\d+\/session)\)\s*$/i)?.[1];
        currentPower = { name: match[1].replace(/\s*\(\d+\/session\)\s*$/i, '').trim(), rulesText: `${session ? `${session}. ` : ''}${match[2].trim()}` };
        powers.push(currentPower);
      } else if (currentPower) currentPower.rulesText = addText(currentPower.rulesText, line.text);
    }

    const effort = Number(rightText.match(/Effort:\s*_\/(\d+)/i)?.[1] ?? 3);
    const strain = Number(rightText.match(/Strain:\s*_\/(\d+)/i)?.[1] ?? 5);
    const secondWind = rightText.match(/Second Wind:\s*(.*?)(?=\s+Special Ability:)/i)?.[1]?.trim() ?? '';
    const specialAbility = rightText.match(/Special Ability:\s*(.*?)(?=\s+BURDENS)/i)?.[1]?.trim() ?? '';
    return { id, name, sourcePage, summary, ideals: ideals.filter(Boolean), effort, strain, secondWind, specialAbility, kits, powers };
  });
}

const sourcePath = resolve(process.argv[2] ?? 'ICON 1.5.pdf');
const outputPath = resolve(process.argv[3] ?? 'src/content/generated/mechanics-1.5.json');
const data = new Uint8Array(await readFile(sourcePath));
const document = await pdfjs.getDocument({ data }).promise;
const lines: LayoutLine[] = [];
for (let pageNumber = 56; pageNumber <= 252; pageNumber += 1) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const textItems = content.items.filter((item) => 'str' in item) as unknown as TextItem[];
  lines.push(...toLines(textItems, pageNumber));
}

const jobs = jobSeeds.map((seed) => parseJob(lines, seed));
const relics = parseRelics(lines);
const bonds = parseBonds(lines);
const artifact = {
  schemaVersion: 2,
  rulesVersion: '1.5',
  jobs,
  relics,
  bonds,
  counts: {
    jobs: jobs.length,
    abilities: jobs.reduce((sum, job) => sum + job.abilities.length, 0),
    relics: relics.length,
    bonds: bonds.length,
  },
};

for (const [key, expected] of Object.entries(EXPECTED_COUNTS) as Array<[keyof typeof EXPECTED_COUNTS, number]>) {
  if (artifact.counts[key] !== expected) {
    throw new Error(`ICON 1.5 mechanics extraction expected ${expected} ${key}, received ${artifact.counts[key]}. Review the source artifact or parser before publishing generated data.`);
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, 'utf8');
console.log(`Extracted ${artifact.counts.abilities} job abilities, ${artifact.counts.relics} relics, and ${artifact.counts.bonds} Bonds to ${outputPath}`);
