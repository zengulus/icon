import { useEffect, useState } from 'react';
import { PHASE_THREE_READY } from '../rules/index.js';
import { useCharacters } from '../context/CharacterContext.js';
import { createCampaign, createEncounterRecord, listCampaigns, listEncounters, type Campaign, type EncounterRecord } from '../services/campaigns.js';

const testingEnabled = PHASE_THREE_READY || import.meta.env.DEV || import.meta.env.VITE_ENABLE_INCOMPLETE_VTT === 'true';

export function Campaigns() {
  const { user, cloudEnabled } = useCharacters();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [encounters, setEncounters] = useState<EncounterRecord[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user || !testingEnabled) return;
    void listCampaigns(user.id).then(setCampaigns).catch((error) => setMessage(error.message));
  }, [user]);

  async function selectCampaign(campaign: Campaign) {
    setSelected(campaign);
    try { setEncounters(await listEncounters(campaign.id)); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load encounters.'); }
  }

  async function addCampaign() {
    if (!user || !name.trim()) return;
    try {
      const campaign = await createCampaign(user.id, name);
      setCampaigns((items) => [campaign, ...items]);
      setName('');
      await selectCampaign(campaign);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create campaign.'); }
  }

  async function addEncounter() {
    if (!user || !selected) return;
    try {
      const encounter = await createEncounterRecord(selected.id, user.id, 'New encounter');
      setEncounters((items) => [encounter, ...items]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create encounter.'); }
  }

  if (!testingEnabled) return <div className="page gate-page"><header className="page-header"><div><p className="eyebrow">Phase 3 quality gate</p><h1>Multiplayer waits for the rules VTT</h1><p>The Render authority, websocket protocol, role checks, persistence, reconnection client, and Discord activity path are implemented but remain unavailable until Phase 2 passes its rules coverage gate.</p></div></header><div className="coverage-list"><div><span className="coverage-icon complete">✓</span><strong>Authoritative shared reducer</strong><em>complete</em></div><div><span className="coverage-icon complete">✓</span><strong>Optimistic revisions and state resynchronization</strong><em>complete</em></div><div><span className="coverage-icon complete">✓</span><strong>Campaign roles and Supabase persistence</strong><em>complete</em></div><div><span className="coverage-icon partial">◐</span><strong>Rules-complete local VTT acceptance</strong><em>blocked by phase 2</em></div></div></div>;

  if (!cloudEnabled || !user) return <div className="page"><header className="page-header"><div><p className="eyebrow">Campaign archive</p><h1>Sign in to collaborate</h1><p>Campaign membership and multiplayer encounters require Supabase authentication. Configure Supabase and sign in from the roster.</p></div></header></div>;

  return <div className="page"><header className="page-header"><div><p className="eyebrow">Engineering preview // multiplayer</p><h1>Campaigns</h1><p>Durable campaign and encounter records for the Render activity service.</p></div><div className="header-actions"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Campaign name" /><button className="button primary" onClick={addCampaign}>Create campaign</button></div></header>{message && <div className="notice">{message}</div>}<div className="campaign-layout"><section className="campaign-list"><h2>Campaign archive</h2>{campaigns.map((campaign) => <button className={selected?.id === campaign.id ? 'selected' : ''} key={campaign.id} onClick={() => void selectCampaign(campaign)}><strong>{campaign.name}</strong><small>{campaign.role} · {new Date(campaign.updatedAt).toLocaleDateString()}</small></button>)}</section><section className="encounter-list"><div><h2>{selected?.name ?? 'Choose a campaign'}</h2>{selected?.role === 'gm' && <button className="button compact" onClick={addEncounter}>New encounter</button>}</div>{encounters.map((encounter) => <article key={encounter.id}><div><strong>{encounter.name}</strong><small>{encounter.state.phase} · round {encounter.state.round} · rev {encounter.revision}</small></div><code>{encounter.id}</code></article>)}</section></div></div>;
}
