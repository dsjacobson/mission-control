import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { dispatchTool, findTool, getManifestTools } from '../manifest.js';

/**
 * Mission Control MCP server — manifest-driven.
 *
 * `tools/list` streams whatever Mission Control publishes at
 * /api/agent/manifest?format=mcp (5-min cache, stale-if-error), PLUS one
 * connector-local tool: `get_approval_export_link`. That tool must stay local
 * because it returns a URL rooted at *this connector's* PUBLIC_URL (which
 * proxies the actual export via /downloads/…), not at Mission Control's URL.
 *
 * `tools/call` dispatches manifest tools via `x_endpoint` (see manifest.ts).
 * The local export-link tool is handled inline below.
 */

const LOCAL_EXPORT_TOOL_NAME = 'get_approval_export_link';

const localExportTool = {
  name: LOCAL_EXPORT_TOOL_NAME,
  description:
    'Returns a link to download an approved item as .docx or .xlsx, for client hand-off. The link is served by this connector (not Mission Control directly) and only works with a valid session.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' as const, description: 'Approval id.' },
      format: { type: 'string' as const, enum: ['docx', 'xlsx'] }
    },
    required: ['id', 'format']
  }
};

export function createMissionControlMcpServer(): Server {
  const server = new Server(
    { name: 'mission-control', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let manifestTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
    try {
      const tools = await getManifestTools();
      manifestTools = tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as { type?: string } | undefined)?.type
          ? (t.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {}, required: [] }
      }));
    } catch (err) {
      // Don't kill the whole tool list on a manifest failure — Claude would see
      // zero tools and appear "disconnected". Log it, then serve just the local
      // tool so the user has something to work with while the backend recovers.
      console.error(
        '[tools/list] manifest fetch failed, serving local tools only:',
        err instanceof Error ? err.message : err
      );
    }
    return {
      tools: [...manifestTools, localExportTool]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    // Local tool: assemble a download URL from this connector's PUBLIC_URL.
    if (name === LOCAL_EXPORT_TOOL_NAME) {
      const a = (args ?? {}) as Record<string, unknown>;
      const id = a.id;
      const format = a.format;
      if (typeof id !== 'string' || (format !== 'docx' && format !== 'xlsx')) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Error: get_approval_export_link requires id (string) and format ("docx"|"xlsx")'
            }
          ]
        };
      }
      const url = new URL(`/downloads/${encodeURIComponent(id)}/${format}`, config.publicUrl);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ url: url.href }, null, 2) }]
      };
    }

    const tool = await findTool(name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Error: unknown tool "${name}". It is not present in the current Mission Control manifest.`
          }
        ]
      };
    }

    try {
      const result = await dispatchTool(tool, args as Record<string, unknown> | undefined);
      if (!result.ok) {
        const snippet = result.bodyText ? result.bodyText.slice(0, 500) : '';
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Mission Control ${tool.x_endpoint.method} ${tool.x_endpoint.path} → ${result.status}${snippet ? `\n${snippet}` : ''}`
            }
          ]
        };
      }
      const text =
        result.bodyJson !== null
          ? JSON.stringify(result.bodyJson, null, 2)
          : result.bodyText || '(empty response)';
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${message}` }]
      };
    }
  });

  return server;
}
