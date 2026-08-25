import { loadCanonicalCorpus, pageClauses, normalizeSourceText, sourceTextContains } from '../src/rules/fidelity/provenance.js';
import { buildProductionWorld } from '../src/rules/fidelity/world.js';
import { ADVANCEMENT_IRRELEVANT_CLAUSES } from '../src/rules/fidelity/advancement-frontier.js';

const corpus = loadCanonicalCorpus('.');
const world = buildProductionWorld();
const adv = world.obligations.filter((o) => o.scopeId === 'advancement');
for (const c of pageClauses(corpus, 240)) {
  if (c.text.includes('experience during')) console.log('RAW240 | ' + JSON.stringify(c.text));
}
const advPassages = adv.flatMap((o) => o.passages.filter((pq) => pq.page === 240).map((pq) => pq.quote));
console.log('PASSAGE-STARTS | ' + JSON.stringify(advPassages.map((q) => q.slice(0, 60))));
