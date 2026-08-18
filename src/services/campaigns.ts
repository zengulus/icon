import { createEncounter, migrateEncounter } from '../rules/encounter.js';
import type { EncounterState } from '../rules/types.js';
import { supabase } from './supabase.js';

export interface Campaign {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  role: 'gm' | 'player';
  updatedAt: string;
}

export interface EncounterRecord {
  id: string;
  campaignId: string;
  name: string;
  state: EncounterState;
  revision: number;
  updatedAt: string;
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function listCampaigns(userId: string): Promise<Campaign[]> {
  const client = requireSupabase();
  const { data: memberships, error: membershipError } = await client.from('campaign_members').select('campaign_id,role');
  if (membershipError) throw membershipError;
  const roleByCampaign = new Map((memberships ?? []).map((row) => [row.campaign_id as string, row.role as 'gm' | 'player']));
  const { data, error } = await client.from('campaigns').select('id,owner_id,name,description,updated_at').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    role: roleByCampaign.get(row.id) ?? (row.owner_id === userId ? 'gm' : 'player'),
    updatedAt: row.updated_at,
  }));
}

export async function createCampaign(userId: string, name: string): Promise<Campaign> {
  const client = requireSupabase();
  const { data, error } = await client.from('campaigns').insert({ owner_id: userId, name: name.trim(), description: '' }).select('id,owner_id,name,description,updated_at').single();
  if (error) throw error;
  return { id: data.id, ownerId: data.owner_id, name: data.name, description: data.description, role: 'gm', updatedAt: data.updated_at };
}

export async function listEncounters(campaignId: string): Promise<EncounterRecord[]> {
  const client = requireSupabase();
  const { data, error } = await client.from('encounters').select('id,campaign_id,name,state,revision,updated_at').eq('campaign_id', campaignId).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, campaignId: row.campaign_id, name: row.name, state: migrateEncounter(row.state), revision: Number(row.revision), updatedAt: row.updated_at }));
}

export async function createEncounterRecord(campaignId: string, userId: string, name: string): Promise<EncounterRecord> {
  const client = requireSupabase();
  const state = createEncounter(name.trim());
  const { data, error } = await client.from('encounters').insert({ campaign_id: campaignId, name: state.name, state, revision: state.revision, created_by: userId }).select('id,campaign_id,name,state,revision,updated_at').single();
  if (error) throw error;
  state.id = data.id;
  const { error: stateError } = await client.from('encounters').update({ state }).eq('id', data.id);
  if (stateError) throw stateError;
  return { id: data.id, campaignId: data.campaign_id, name: data.name, state, revision: Number(data.revision), updatedAt: data.updated_at };
}
