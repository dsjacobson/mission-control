import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  // Port this server listens on.
  port: Number(process.env.PORT ?? 3300),

  // Public HTTPS URL this server is reachable at (e.g. https://seo-agent-hub-3.preview.emergentagent.com/mcp-connector)
  // This MUST be the externally reachable URL, not localhost, because Claude's remote MCP
  // client connects from Anthropic's cloud, not from your machine.
  publicUrl: required('PUBLIC_URL'),

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
