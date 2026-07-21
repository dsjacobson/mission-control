import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { dispatchTool, findTool, getManifestTools } from '../manifest.js';

/**
 * Manifest-driven MCP server.
 *
 * `tools/list` streams whatever the SEO Toolkit currently publishes at
 * /api/agent/manifest?format=mcp (5-min cache, stale-if-error). `tools/call`
 * uses the manifest's `x_endpoint` block to dispatch generically — no per-tool
 * client code required.
 *
 * Uses the low-level Server (not McpServer) because McpServer.registerTool
 * expects Zod shapes; the manifest gives us JSON Schema, which the low-level
 * Server accepts as-is.
 */
export function createSeoToolkitMcpServer(): Server {
  const server = new Server(
    { name: 'seo-toolkit', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await getManifestTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as { type?: string } | undefined)?.type
          ? (t.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {}, required: [] }
      }))
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = await findTool(name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Error: unknown tool "${name}". It was not present in the current SEO Toolkit manifest.`
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
              text: `SEO Toolkit ${tool.x_endpoint.method} ${tool.x_endpoint.path} → ${result.status}${snippet ? `\n${snippet}` : ''}`
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
