import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Resolve the public URL this server is reachable at. Prefers an explicit
 * PUBLIC_URL (e.g. a custom domain), and falls back to RENDER_EXTERNAL_URL,
 * which Render auto-injects into every service at deploy time. This lets
 * first-time deploys work without any env-var bootstrap dance.
 */
function resolvePublicUrl(): string {
  const explicit = (process.env.PUBLIC_URL ?? '').trim();
  if (explicit) return explicit;
  const renderUrl = (process.env.RENDER_EXTERNAL_URL ?? '').trim();
  if (renderUrl) return renderUrl;
  throw new Error(
    'Missing PUBLIC_URL and RENDER_EXTERNAL_URL is not set either. ' +
      'Set PUBLIC_URL to the public HTTPS URL of this MCP server (no trailing slash).'
  );
}

export const config = {
  // Port this server listens on.
  port: Number(process.env.PORT ?? 3300),

  // Public HTTPS URL this server is reachable at (e.g. https://mission-control-mcp-xxxx.onrender.com).
  // This MUST be the externally reachable URL, not localhost, because Claude's remote MCP
  // client connects from Anthropic's cloud, not from your machine.
  publicUrl: resolvePublicUrl(),

  // The password Derek enters on the /login consent screen when Claude first connects.
  // This is the only gate on who can authorize this connector. Keep it out of source control.
  dashboardPassword: required('DASHBOARD_PASSWORD'),

  // Mission Control's own API, already secured by its existing auth.
  missionControl: {
    baseUrl: required('MISSION_CONTROL_API_BASE_URL'),
    apiKey: required('MISSION_CONTROL_API_KEY')
  },

  // How long issued access tokens and authorization codes last.
  accessTokenTtlSeconds: 60 * 60, // 1 hour
  authorizationCodeTtlSeconds: 5 * 60 // 5 minutes
};
