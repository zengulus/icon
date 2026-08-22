import { supabase } from './supabase.js';
export { assetBackground, safeAssetUrl } from '../vtt/presentation.js';

export async function uploadImage(file: File, userId: string) {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be uploaded.');
  if (file.size > 50 * 1024 * 1024) throw new Error('Images must be smaller than 50 MB.');
  const cleanName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const path = `${userId}/${crypto.randomUUID()}-${cleanName}`;
  const { error } = await supabase.storage.from('icon-assets').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from('icon-assets').getPublicUrl(path).data.publicUrl;
}
