import crypto from 'node:crypto';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

export interface IssuedToken {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

export interface IssuedRefreshToken {
  clientId: string;
  scopes: string[];
  resource?: string;
}

/**
 * Everything here is in-memory, which is fine for a single-user personal connector
 * run as one long-lived process. If this ever runs as more than one instance (e.g.
 * behind a load balancer, or on a serverless platform that spins up fresh instances),
 * swap these Maps for a shared store (Redis, a Mission Control database table, etc.)
 * so tokens issued by one instance are recognized by another.
 */
class OAuthStore {
  readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly authorizationCodes = new Map<string, PendingAuthorization>();
  private readonly accessTokens = new Map<string, IssuedToken>();
  private readonly refreshTokens = new Map<string, IssuedRefreshToken>();

  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  saveAuthorizationCode(code: string, data: PendingAuthorization): void {
    this.authorizationCodes.set(code, data);
  }

  getAuthorizationCode(code: string): PendingAuthorization | undefined {
    const entry = this.authorizationCodes.get(code);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.authorizationCodes.delete(code);
      return undefined;
    }
    return entry;
  }

  consumeAuthorizationCode(code: string): void {
    this.authorizationCodes.delete(code);
  }

  saveAccessToken(token: string, data: IssuedToken): void {
    this.accessTokens.set(token, data);
  }

  getAccessToken(token: string): IssuedToken | undefined {
    const entry = this.accessTokens.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.accessTokens.delete(token);
      return undefined;
    }
    return entry;
  }

  revokeAccessToken(token: string): void {
    this.accessTokens.delete(token);
  }

  saveRefreshToken(token: string, data: IssuedRefreshToken): void {
    this.refreshTokens.set(token, data);
  }

  getRefreshToken(token: string): IssuedRefreshToken | undefined {
    return this.refreshTokens.get(token);
  }

  revokeRefreshToken(token: string): void {
    this.refreshTokens.delete(token);
  }
}

export const oauthStore = new OAuthStore();
