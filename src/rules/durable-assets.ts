/**
 * Rules-level validation for URLs that become part of a durable room snapshot.
 *
 * Browser object URLs are scoped to one browser document and cannot be used by
 * a reconnecting client or a cold Render room. Keep this check independent of
 * React so the websocket protocol, reducer, and checkpoint validation all use
 * the same definition.
 */
export const MAX_DURABLE_ASSET_URL_LENGTH = 2_048;

export function durableAssetUrlProblem(value: string): string | null {
  if (value.length > MAX_DURABLE_ASSET_URL_LENGTH) return 'is too long.';
  // URI schemes are case-insensitive. Trim first so a padded `blob:` value
  // cannot bypass the durable-state boundary.
  if (value.trim().toLocaleLowerCase().startsWith('blob:')) return 'cannot use a browser-only blob URL.';
  return null;
}

export function isDurableAssetUrl(value: string): boolean {
  return durableAssetUrlProblem(value) === null;
}
