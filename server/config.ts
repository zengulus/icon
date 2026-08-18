export interface ServerConfig {
  port: number;
  allowedOrigins: string[];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  discordWebhookUrl: string;
  allowDevAuth: boolean;
}

export function loadConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT ?? 8787),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((value) => value.trim()).filter(Boolean),
    supabaseUrl: process.env.SUPABASE_URL?.trim() ?? '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() ?? '',
    allowDevAuth: process.env.ALLOW_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production',
  };
}
