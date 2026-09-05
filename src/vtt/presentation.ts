/**
 * Browser-safe presentation helpers. These deliberately have no storage,
 * authentication, or upload dependency so local tactical surfaces can use
 * them without loading the Supabase client.
 */
export function safeAssetUrl(input: string): string {
  const value = input.trim();
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'https:') return url.href;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.href;
    return '';
  } catch {
    return '';
  }
}

export function assetBackground(input: string): { backgroundImage: string } | undefined {
  const url = safeAssetUrl(input);
  return url ? { backgroundImage: `url("${url.replaceAll('"', '%22')}")` } : undefined;
}

/** IDs for user-created table records; creation remains a room command. */
export function makeTableId(prefix: string): string {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
