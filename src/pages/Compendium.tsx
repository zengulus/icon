import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { compendium, pagesForSection, searchCompendium, sectionById } from '../content/compendium.js';
import { BONDS, RELICS, findJob } from '../rules/index.js';
import { FOE_PROFILES, FOE_ROLES, findFoeProfile, findFoeRole } from '../rules/foes.js';
import type { FoeProfileDefinition } from '../rules/types.js';

function FoeCatalog({ profiles }: { profiles: readonly FoeProfileDefinition[] }) {
  return (
    <section className="mechanics-panel">
      <div className="mechanics-intro">
        <p className="eyebrow">Structured foe content</p>
        <h2>{profiles.length} profiles and components</h2>
        <p>{profiles.reduce((total, profile) => total + profile.abilities.length, 0)} costed abilities, with source roles, inheritance links, and page references.</p>
      </div>
      <div className="foe-catalog">
        {profiles.map((profile) => {
          const role = findFoeRole(profile.roleId);
          const parent = profile.parentId ? findFoeProfile(profile.parentId) : undefined;
          return (
            <details className={`role-${profile.roleId}`} key={profile.id}>
              <summary>
                <span><strong>{profile.name}</strong><small>{role?.name ?? 'Special'} · {profile.kind}{parent ? ` · modifies ${parent.name}` : ''}</small></span>
                <em>p.{profile.source.page}</em>
              </summary>
              {profile.description && <p>{profile.description}</p>}
              {profile.traitsText && profile.traitsText !== profile.description && <div className="rules-block">{profile.traitsText}</div>}
              {profile.abilities.length === 0 && <p>This entry modifies its parent through traits only.</p>}
              {profile.abilities.map((ability) => (
                <div className="foe-ability" key={ability.id}>
                  <h4>{ability.name}</h4>
                  <small>{ability.header}</small>
                  <p>{ability.rulesText}</p>
                </div>
              ))}
            </details>
          );
        })}
      </div>
    </section>
  );
}

export function Compendium() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const sectionId = params.get('section') ?? '';
  const pageNumber = Number(params.get('page') ?? 0);
  const section = sectionId ? sectionById(sectionId) : undefined;
  const results = useMemo(() => query.trim() ? searchCompendium(query, sectionId || undefined) : [], [query, sectionId]);
  const visiblePages = section ? pagesForSection(section.id) : [];
  const selectedPage = compendium.pages.find(({ number }) => number === pageNumber) ?? visiblePages[0];
  const categories = [...new Set(compendium.sections.map((item) => item.category))];
  const structuredJob = section ? findJob(section.id) : undefined;
  const structuredFoes = section ? FOE_PROFILES.filter((profile) => profile.source.sectionId === section.id) : [];

  function selectSection(id: string) {
    const next = new URLSearchParams(params);
    next.set('section', id);
    next.delete('page');
    setParams(next);
  }

  function selectPage(number: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(number));
    const page = compendium.pages[number - 1];
    if (page) next.set('section', page.sectionId);
    setParams(next);
  }

  return (
    <div className="compendium-page">
      <aside className="rules-nav">
        <div className="rules-nav-head"><p className="eyebrow">ICON 1.5</p><h2>Rules index</h2><small>{compendium.metadata.pageCount} extracted pages</small></div>
        {categories.map((category) => <div className="rules-group" key={category}><h3>{category}</h3>{compendium.sections.filter((item) => item.category === category).map((item) => <button className={item.id === sectionId ? 'active' : ''} key={item.id} onClick={() => selectSection(item.id)}><span>{item.title}</span><small>{item.startPage}</small></button>)}</div>)}
      </aside>

      <div className="rules-reader">
        <header className="rules-search">
          <form onSubmit={(event) => { event.preventDefault(); const next = new URLSearchParams(params); next.set('q', query); setParams(next); }}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={section ? `Search within ${section.title}…` : 'Search every rule, Job, ability, foe, and glossary term…'} /><button className="button compact">Search</button></form>
          {section && <button className="text-button" onClick={() => { setQuery(''); setParams({}); }}>Search all sections</button>}
        </header>

        {query.trim() ? (
          <div className="search-results">
            <div className="reader-title"><p className="eyebrow">Search results</p><h1>“{query}”</h1><p>{results.length} matching pages{section ? ` in ${section.title}` : ''}</p></div>
            {results.length ? results.map(({ page, section: resultSection, excerpt }) => <button className="result-card" key={page.number} onClick={() => { selectPage(page.number); setQuery(''); }}><div><span>PAGE {page.number}</span><strong>{resultSection?.title}</strong></div><p>{excerpt}…</p></button>) : <div className="empty-state"><h2>No exact match</h2><p>Try fewer words or search the complete sourcebook.</p></div>}
          </div>
        ) : selectedPage ? (
          <article className="source-page">
            <div className="reader-title"><p className="eyebrow">{section?.category}</p><h1>{section?.title}</h1><p>Source page {selectedPage.number} of {compendium.metadata.pageCount}</p></div>

            {section?.id === 'bonds' && <section className="mechanics-panel"><div className="mechanics-intro"><p className="eyebrow">Structured character content</p><h2>{BONDS.length} Bonds</h2><p>Ideals, Effort, Strain, Second Wind, special features, gear kits, and all 120 Bond powers.</p></div><div className="bond-catalog">{BONDS.map((bond) => <details key={bond.id}><summary><span><strong>{bond.name}</strong><small>{bond.actions.join(' / ')} · Effort {bond.effort} · Strain {bond.strain}</small></span><em>p.{bond.source.page}</em></summary><p>{bond.summary}</p><h4>Ideals</h4><ul>{bond.ideals.map((ideal) => <li key={ideal}>{ideal}</li>)}</ul><p><b>Second Wind:</b> {bond.secondWind}</p><p><b>Special:</b> {bond.specialAbility}</p><h4>Kits</h4>{bond.kits.map((kit) => <p key={kit.name}><b>{kit.name}:</b> {kit.itemsText}</p>)}<h4>Powers</h4>{bond.powerDetails.map((power) => <p key={power.name}><b>{power.name}:</b> {power.rulesText}</p>)}</details>)}</div></section>}

            {structuredJob && <section className="mechanics-panel"><div className="mechanics-intro"><div><p className="eyebrow">Structured mechanics</p><h2>{structuredJob.name}</h2><p>{structuredJob.traitsText}</p></div>{structuredJob.limitBreak && <details><summary>Limit Break · {structuredJob.limitBreak.name}</summary><p>{structuredJob.limitBreak.rulesText}</p></details>}</div><div className="mechanic-abilities">{([1, 2, 3] as const).map((chapter) => <div key={chapter}><h3>Chapter {chapter}</h3>{structuredJob.abilities.filter((ability) => ability.chapter === chapter).map((ability) => <details key={ability.id}><summary><span><strong>{ability.name}</strong><small>{ability.header}</small></span><em>p.{ability.source.page}</em></summary><p>{ability.summary}</p><div className="rules-block">{ability.rulesText}</div><ol><li>{ability.talents[0]}</li><li>{ability.talents[1]}</li></ol><strong className="mastery-name">Mastery · {ability.mastery?.name}</strong><p>{ability.mastery?.text}</p></details>)}</div>)}</div></section>}

            {section?.id === 'relics' && <section className="mechanics-panel"><div className="mechanics-intro"><p className="eyebrow">Structured mechanics</p><h2>{RELICS.length} Relics</h2><p>Ranks I–III, Aspected effects, and quests extracted from pages 245–252.</p></div><div className="relic-catalog">{RELICS.map((relic) => <details key={relic.id}><summary><span><strong>{relic.name}</strong><small>p.{relic.source.page}</small></span></summary><p>{relic.description}</p><ol>{relic.ranks.map((rank, index) => <li key={rank}><b>{['I', 'II', 'III'][index]}.</b> {rank}</li>)}</ol><p><b>Aspected:</b> {relic.aspect}</p><p><b>Aspect quest:</b> {relic.aspectQuest}</p></details>)}</div></section>}

            {section?.id === 'foe-glossary' && <section className="mechanics-panel"><div className="mechanics-intro"><p className="eyebrow">Structured foe roles</p><h2>Foe statistics</h2><p>The six source roles used to resolve every color-coded foe profile.</p></div><div className="foe-role-grid">{FOE_ROLES.map((role) => <article className={`role-${role.id}`} key={role.id}><div><h3>{role.name}</h3><small>p.{role.source.page}</small></div><dl><div><dt>HP</dt><dd>{role.hp ?? (role.hpPerPlayer ? `${role.hpPerPlayer}/player` : 'hits')}</dd></div><div><dt>DEF</dt><dd>{role.defense}</dd></div><div><dt>SPD</dt><dd>{role.speed}/{role.dash}</dd></div><div><dt>FRAY</dt><dd>{role.fray}</dd></div><div><dt>[D]</dt><dd>d{role.damageDie}</dd></div></dl><p>{role.traitsText}</p></article>)}</div></section>}

            {structuredFoes.length > 0 && <FoeCatalog profiles={structuredFoes} />}

            <div className="page-tabs">{visiblePages.map((page) => <button className={page.number === selectedPage.number ? 'active' : ''} key={page.number} onClick={() => selectPage(page.number)}>{page.number}</button>)}</div>
            <div className="source-text">{selectedPage.text.split('\n').map((line, index) => <p key={index}>{line}</p>)}</div>
            <footer>{compendium.metadata.attribution}</footer>
          </article>
        ) : (
          <div className="rules-welcome"><p className="eyebrow">Rules library</p><h1>Every page. One index.</h1><p>The complete ICON 1.5 sourcebook is extracted into searchable, versioned content. Choose a section or search for a rule.</p><div className="welcome-stats"><span><b>501</b> pages</span><span><b>75</b> indexed sections</span><span><b>144</b> Job abilities</span><span><b>120</b> Bond powers</span><span><b>40</b> relics</span><span><b>449</b> foe entries</span><span><b>1.5</b> rules version</span></div></div>
        )}
      </div>
    </div>
  );
}
