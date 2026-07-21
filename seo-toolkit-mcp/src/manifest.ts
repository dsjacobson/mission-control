import { config } from './config.js';

/**
 * Manifest-driven tool discovery.
 *
 * The SEO Toolkit publishes a live, MCP-ready manifest at
 *   GET {baseUrl}/api/agent/manifest?format=mcp    (public, no auth)
 *
 * Response shape:
 * {
 *   "tools": [
 *     {
 *       "name": "recipe_advance",
 *       "description": "...",
 *       "inputSchema": { "type": "object", "properties": {...}, "required": [...] },
 *       "x_endpoint": { "method": "POST", "path": "/api/tools/recipe-advance" },
 *       "x_cost": "billed"
 *     }
 *   ]
 * }
 *
 * This module owns fetching + caching that manifest and dispatching tool calls
 * generically via `x_endpoint`. Adding a tool on the toolkit side requires
 * zero changes here — a manifest refresh picks it up automatically.
 */

export interface ManifestEndpoint {
  method: string;
  path: string;
}

export interface ManifestTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  x_endpoint: ManifestEndpoint;
  x_cost?: string;
  [k: string]: unknown;
}

interface ManifestResponse {
  tools: ManifestTool[];
}

// 5-minute TTL is short enough that new toolkit tools show up within one
// session, long enough that we're not hammering the toolkit on every list.
const MANIFEST_TTL_MS = 5 * 60 * 1000;

interface CachedManifest {
  tools: ManifestTool[];
  fetchedAt: number;
}

let cache: CachedManifest | null = null;
let inflight: Promise<ManifestTool[]> | null = null;

async function fetchManifest(): Promise<ManifestTool[]> {
  const url = new URL('/api/agent/manifest', config.seoToolkit.baseUrl);
  url.searchParams.set('format', 'mcp');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`manifest fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as ManifestResponse;
  if (!json || !Array.isArray(json.tools)) {
    throw new Error('manifest response missing tools[]');
  }
  return json.tools;
}

/**
 * Get the current tool list. Cached for MANIFEST_TTL_MS.
 *
 * On refresh failure: log + return the last good copy (stale-if-error) so a
 * transient toolkit hiccup doesn't blank the tool list mid-Claude-session.
 * Only throws if we have nothing at all cached and the very first fetch fails.
 */
export async function getManifestTools(options: { forceRefresh?: boolean } = {}): Promise<ManifestTool[]> {
  const now = Date.now();
  const isFresh = cache && now - cache.fetchedAt < MANIFEST_TTL_MS && !options.forceRefresh;
  if (isFresh) return cache!.tools;

  if (!inflight) {
    inflight = (async () => {
      try {
        const tools = await fetchManifest();
        cache = { tools, fetchedAt: Date.now() };
        return tools;
      } catch (err) {
        if (cache) {
          console.warn(
            '[manifest] refresh failed, serving stale copy:',
            err instanceof Error ? err.message : err
          );
          return cache.tools;
        }
        throw err;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/** Substitute {name} placeholders in `path` from args. Consumes matched keys from args. */
function substitutePathParams(path: string, args: Record<string, unknown>): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = args[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`missing required path param: ${name}`);
    }
    delete args[name];
    return encodeURIComponent(String(value));
  });
}

export interface DispatchResult {
  status: number;
  ok: boolean;
  bodyText: string;
  bodyJson: unknown | null;
}

/**
 * Dispatch a tool call to the SEO Toolkit via the endpoint metadata in the
 * manifest. Path params are substituted from `args`; remaining args go to
 * query string (GET) or JSON body (POST/PUT/PATCH). Always sends X-API-Key.
 */
export async function dispatchTool(
  tool: ManifestTool,
  rawArgs: Record<string, unknown> | undefined
): Promise<DispatchResult> {
  const args = { ...(rawArgs ?? {}) };
  const method = (tool.x_endpoint.method || 'GET').toUpperCase();
  const pathWithParams = substitutePathParams(tool.x_endpoint.path, args);

  const url = new URL(pathWithParams, config.seoToolkit.baseUrl);
  const init: RequestInit = {
    method,
    headers: {
      'X-API-Key': config.seoToolkit.apiKey,
      Accept: 'application/json'
    }
  };

  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  } else {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(args);
  }

  const res = await fetch(url, init);
  const bodyText = await res.text();
  let bodyJson: unknown | null = null;
  if (bodyText) {
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // non-JSON response — leave bodyJson null, caller will use bodyText
    }
  }
  return { status: res.status, ok: res.ok, bodyText, bodyJson };
}

/** Look up a tool by name in the current manifest, force-refreshing once on miss. */
export async function findTool(name: string): Promise<ManifestTool | null> {
  const tools = await getManifestTools();
  const hit = tools.find((t) => t.name === name);
  if (hit) return hit;
  // Miss — could be a newly added tool on the toolkit side that landed after
  // our last cached fetch. Force a refresh and try one more time.
  const refreshed = await getManifestTools({ forceRefresh: true });
  return refreshed.find((t) => t.name === name) ?? null;
}
