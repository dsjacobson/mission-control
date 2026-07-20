import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { config } from '../config.js';
import { oauthStore } from './store.js';
import { renderLoginPage } from './loginPage.js';

class SeoToolkitClientsStore implements OAuthRegisteredClientsStore {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return oauthStore.clients.get(clientId);
  }

  registerClient(
    client: OAuthClientInformationFull
  ): OAuthClientInformationFull {
    oauthStore.clients.set(client.client_id, client);
    return client;
  }
}

export class SeoToolkitOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new SeoToolkitClientsStore();

  /**
   * Called when Claude's browser hits GET /authorize. We don't auto-approve: we render
   * a password-gated consent page. The page posts to our own /login route (see index.ts),
   * which finishes the flow by issuing a code and redirecting back to Claude.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const html = renderLoginPage({
      clientName: client.client_name ?? client.client_id,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
      scope: params.scopes?.join(' '),
      resource: params.resource?.toString()
    });
    res.status(200).setHeader('Content-Type', 'text/html').send(html);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const entry = oauthStore.getAuthorizationCode(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid or expired authorization code');
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const entry = oauthStore.getAuthorizationCode(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid or expired authorization code');
    }
    // Codes are single use.
    oauthStore.consumeAuthorizationCode(authorizationCode);

    return this.issueTokens(client.client_id, entry.scopes, entry.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const entry = oauthStore.getRefreshToken(refreshToken);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid refresh token');
    }
    // Rotate the refresh token on use.
    oauthStore.revokeRefreshToken(refreshToken);
    return this.issueTokens(client.client_id, scopes ?? entry.scopes, entry.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const entry = oauthStore.getAccessToken(token);
    if (!entry) {
      throw new Error('Invalid or expired access token');
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: entry.scopes,
      expiresAt: Math.floor(entry.expiresAt / 1000),
      resource: entry.resource ? new URL(entry.resource) : undefined
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    oauthStore.revokeAccessToken(request.token);
    oauthStore.revokeRefreshToken(request.token);
  }

  private issueTokens(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const accessToken = oauthStore.generateToken();
    const refreshToken = oauthStore.generateToken();
    const expiresAt = Date.now() + config.accessTokenTtlSeconds * 1000;

    oauthStore.saveAccessToken(accessToken, { clientId, scopes, resource, expiresAt });
    oauthStore.saveRefreshToken(refreshToken, { clientId, scopes, resource });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(' ')
    };
  }
}
