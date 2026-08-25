export interface ServerConfig {
  port: number;
  allowedOrigins: string[];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  discordWebhookUrl: string;
  allowDevAuth: boolean;
  /** Explicit non-production escape hatch for the engineering VTT preview.
   * While the full PHASE_THREE_READY evidence is unbound from deployment
   * configuration, this is the ONLY admission path for multiplayer joins —
   * coverage readiness never admits a deployment. */
  allowIncompleteVtt: boolean;
}

export function loadConfig(): ServerConfig {
  // Test identities exist solely for the browser/transport acceptance suites.
  // A non-production deployment must still authenticate against Supabase.
  const allowDevAuth = process.env.NODE_ENV === 'test' && process.env.ALLOW_DEV_AUTH === 'true';
  // The source-rule phase gate cannot be overridden in a production Render
  // process. Test harnesses use dev auth; a local developer can opt in with
  // both NODE_ENV=development and this separate explicit flag.
  const allowIncompleteVtt = allowDevAuth
    || (process.env.NODE_ENV === 'development' && process.env.ALLOW_INCOMPLETE_VTT === 'true');
  return {
    port: Number(process.env.PORT ?? 8787),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((value) => value.trim()).filter(Boolean),
    supabaseUrl: process.env.SUPABASE_URL?.trim() ?? '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() ?? '',
    allowDevAuth,
    allowIncompleteVtt,
  };
}
