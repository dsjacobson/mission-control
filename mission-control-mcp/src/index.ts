import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import express from 'express';
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { MissionControlOAuthProvider } from './auth/provider.js';
import { oauthStore } from './auth/store.js';
import { renderLoginPage } from './auth/loginPage.js';
import { createMissionControlMcpServer } from './mcp/server.js';
import { missionControl } from './missionControlClient.js';

const app = express();
app.use(express.urlencoded({ extended: true }));

const publicUrl = new URL(config.publicUrl);
const mcpEndpointUrl = new URL('/mcp', publicUrl);

const provider = new MissionControlOAuthProvider();

// Standard MCP OAuth endpoints: /authorize, /token, /register, /revoke, and the
// well-known metadata documents Claude uses to discover them.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: publicUrl,
    resourceServerUrl: mcpEndpointUrl,
    scopesSupported: ['mission-control'],
    resourceName: 'Mission Control'
  })
);

// Completes the flow that provider.authorize() started. See loginPage.ts for why
// this lives on its own route instead of inside the provider's authorize() method.
app.post('/login', async (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, scope, resource, password } =
    req.body as Record<string, string | undefined>;

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).send('Missing required authorization parameters.');
    return;
  }

  const client = await provider.clientsStore.getClient(client_id);
  if (!client) {
    res.status(400).send('Unknown client.');
    return;
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    res.status(400).send('Unregistered redirect_uri.');
    return;
  }

  if (password !== config.dashboardPassword) {
    res
      .status(401)
      .setHeader('Content-Type', 'text/html')
      .send(
        renderLoginPage({
          clientName: client.client_name ?? client.client_id,
          clientId: client_id,
          redirectUri: redirect_uri,
          state,
          codeChallenge: code_challenge,
          scope,
          resource,
          error: 'Incorrect password. Try again.'
        })
      );
    return;
  }

  const code = oauthStore.generateToken();
  oauthStore.saveAuthorizationCode(code, {
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    scopes: scope ? scope.split(' ') : [],
    resource,
    expiresAt: Date.now() + config.authorizationCodeTtlSeconds * 1000
  });

  const target = new URL(redirect_uri);
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);
  res.redirect(302, target.toString());
});

// The actual MCP endpoint. Everything above exists to gate this behind a real access
// token; everything it does is delegated to Mission Control's own API and auth.
const mcpServer = createMissionControlMcpServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID()
});
await mcpServer.connect(transport);

const requireAuth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpEndpointUrl)
});

app.post('/mcp', requireAuth, express.json(), (req, res) => {
  transport.handleRequest(req, res, req.body);
});
app.get('/mcp', requireAuth, (req, res) => {
  transport.handleRequest(req, res);
});
app.delete('/mcp', requireAuth, (req, res) => {
  transport.handleRequest(req, res);
});

// Streams an approval export through this server, so the raw Mission Control API key
// never has to leave this process. Protected by the same bearer token as /mcp.
app.get('/downloads/:id/:format', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const format = String(req.params.format);
  if (format !== 'docx' && format !== 'xlsx') {
    res.status(400).send('format must be docx or xlsx');
    return;
  }
  try {
    const { body, contentType } = await missionControl.fetchApprovalExport(id, format);
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${id}.${format}"`);
    if (!body) {
      res.status(502).send('Mission Control returned no file content.');
      return;
    }
    Readable.fromWeb(body as never).pipe(res);
  } catch (error) {
    res.status(502).send(error instanceof Error ? error.message : String(error));
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`Mission Control MCP server listening on port ${config.port}`);
  console.log(`Public URL: ${publicUrl.href}`);
  console.log(`MCP endpoint: ${mcpEndpointUrl.href}`);
});
