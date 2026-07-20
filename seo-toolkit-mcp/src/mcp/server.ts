import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSeoToolkitTools } from './tools.js';

export function createSeoToolkitMcpServer(): McpServer {
  const server = new McpServer({
    name: 'seo-toolkit',
    version: '0.1.0'
  });

  registerSeoToolkitTools(server);

  return server;
}
