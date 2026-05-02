/**
 * Technical Analysis Module
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerTechnicalAnalysisTools } from "./tools.js"

export function registerTechnicalAnalysis(server: McpServer) {
  registerTechnicalAnalysisTools(server)
}
