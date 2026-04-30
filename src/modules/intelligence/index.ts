import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerIntelligenceTools } from "./tools.js"

export function registerIntelligence(server: McpServer) {
  registerIntelligenceTools(server)
}
