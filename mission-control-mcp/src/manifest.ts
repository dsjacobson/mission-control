import { config } from './config.js';

/**
 * Manifest-driven tool discovery for Mission Control.
 *
 * Mission Control's `/api/agent/manifest?format=mcp` returns a flat list of
 * tools in the same shape as the SEO Toolkit's manifest — {name, description,
 * inputSchema (JSON Schema), x_endpoint: {method, path}, x_cost}. Path params
 * use `{name}` syntax and are substituted from tool args by the dispatcher.
 *
 * Adding a tool in `backend/agent_manifest.py::build_mcp_manifest()` makes it
 * visible in Claude Desktop after the next connector restart — no connector
 * code change required.
 *
 * The MCP endpoint is public (exempt from the API-key gate) so the connector
 * can fetch it without a key; individual tool dispatches still authenticate
 * with X-API-Key.
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

const MANIFEST_TTL_MS = 5 * 60 * 1000;

interface CachedManifest {
  tools: ManifestTool[];
  fetchedAt: number;
}

let cache: CachedManifest | null = null;
let inflight: Promise<ManifestTool[]> | null = null;

async function fetchManifest(): Promise<ManifestTool[]> {
  const url = new URL('/api/agent/manifest', config.missionControl.baseUrl);
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
 * Get the current tool list. Cached for MANIFEST_TTL_MS. On refresh failure
 * the last good copy is served (stale-if-error) so a transient Mission Control
 * hiccup never blanks the tool list mid-Claude-session.
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

/** Substitute {name} placeholders in `path` from args. Consumes matched keys. */
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

export async function dispatchTool(
  tool: ManifestTool,
  rawArgs: Record<string, unknown> | undefined
): Promise<DispatchResult> {
  const args = { ...(rawArgs ?? {}) };
  const method = (tool.x_endpoint.method || 'GET').toUpperCase();
  const pathWithParams = substitutePathParams(tool.x_endpoint.path, args);

  const url = new URL(pathWithParams, config.missionControl.baseUrl);
  const init: RequestInit = {
    method,
    headers: {
      'X-API-Key': config.missionControl.apiKey,
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
      // non-JSON — bodyJson stays null
    }
  }
  return { status: res.status, ok: res.ok, bodyText, bodyJson };
}

export async function findTool(name: string): Promise<ManifestTool | null> {
  const tools = await getManifestTools();
  const hit = tools.find((t) => t.name === name);
  if (hit) return hit;
  const refreshed = await getManifestTools({ forceRefresh: true });
  return refreshed.find((t) => t.name === name) ?? null;
}
