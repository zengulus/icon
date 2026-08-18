interface DiscordNotice {
  title: string;
  description: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

let lastSentAt = 0;

export async function sendDiscordNotice(webhookUrl: string, notice: DiscordNotice) {
  if (!webhookUrl) return { delivered: false, reason: 'not-configured' } as const;
  const now = Date.now();
  if (now - lastSentAt < 1_500) return { delivered: false, reason: 'rate-limited' } as const;
  lastSentAt = now;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'ICON Field Guide',
      allowed_mentions: { parse: [] },
      embeds: [{
        title: notice.title.slice(0, 256),
        description: notice.description.slice(0, 4_096),
        color: notice.color ?? 0xd8ef62,
        fields: notice.fields?.slice(0, 10),
        timestamp: new Date().toISOString(),
        footer: { text: 'ICON 1.5 · server activity' },
      }],
    }),
  });
  if (!response.ok) throw new Error(`Discord webhook rejected the request (${response.status}).`);
  return { delivered: true } as const;
}
