import type { IconCharacter } from '../rules/index.js';
import { migrateCharacter } from '../rules/index.js';
import { supabase } from './supabase.js';

const LOCAL_KEY = 'icon.characters.v1';

function localCharacters(): IconCharacter[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown[];
    return parsed.map(migrateCharacter);
  } catch {
    return [];
  }
}

function writeLocal(characters: IconCharacter[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(characters));
}

export async function listCharacters(userId: string | null): Promise<IconCharacter[]> {
  if (!supabase || !userId) return localCharacters();
  const { data, error } = await supabase.from('characters').select('data').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => migrateCharacter(row.data));
}

export async function saveCharacter(character: IconCharacter, userId: string | null): Promise<IconCharacter> {
  const updated = { ...character, ownerId: userId, updatedAt: new Date().toISOString() };
  if (!supabase || !userId) {
    const characters = localCharacters();
    const index = characters.findIndex(({ id }) => id === updated.id);
    if (index >= 0) characters[index] = updated;
    else characters.unshift(updated);
    writeLocal(characters);
    return updated;
  }
  const { error } = await supabase.from('characters').upsert({
    id: updated.id,
    owner_id: userId,
    name: updated.name || 'Unnamed Icon',
    rules_version: updated.rulesVersion,
    schema_version: updated.schemaVersion,
    data: updated,
    updated_at: updated.updatedAt,
  });
  if (error) throw error;
  return updated;
}

export async function deleteCharacter(id: string, userId: string | null) {
  if (!supabase || !userId) {
    writeLocal(localCharacters().filter((character) => character.id !== id));
    return;
  }
  const { error } = await supabase.from('characters').delete().eq('id', id);
  if (error) throw error;
}

export function downloadCharacter(character: IconCharacter) {
  const blob = new Blob([`${JSON.stringify(character, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${character.name || 'icon-character'}.icon.json`.replace(/[^a-z0-9._-]+/gi, '-');
  anchor.click();
  URL.revokeObjectURL(url);
}
