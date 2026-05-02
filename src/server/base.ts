/**
 * MemeTrader Analytics Hub - Server Base
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerAnalytics } from "@/evm.js"
import Logger from "@/utils/logger.js"

export const startServer = async () => {
  try {
    const server = new McpServer({
      name: "MemeTrader Analytics Hub",
      version: "1.0.0",
      description: "Analytics MCP server - Market data, DEX analytics, portfolio, security"
    })

    Logger.info("Registering analytics modules...")
    registerAnalytics(server)
    
    Logger.info("MemeTrader Analytics Hub initialized")
    
    return server
  } catch (error) {
    Logger.error("Failed to initialize server:", error)
    process.exit(1)
  }
}