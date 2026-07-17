import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMissionControlTools } from './tools.js';

export function createMissionControlMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mission-control',
    version: '0.1.0'
  });

  registerMissionControlTools(server);

  return server;
}
