#!/usr/bin/env node
/**
 * MemeTrader Analytics Hub MCP Server
 * Market data, DEX analytics, portfolio tracking, security
 */
import { startStdioServer } from "./server/stdio"
import logger from "./utils/logger"

async function main() {
  logger.info("Starting MemeTrader Analytics Hub MCP...")
  
  const server = await startStdioServer()
  
  if (!server) {
    logger.error("Failed to start server")
    process.exit(1)
  }

  const handleShutdown = async () => {
    if ("close" in server && typeof server.close === "function") {
      await server.close()
    }
    process.exit(0)
  }

  process.on("SIGINT", handleShutdown)
  process.on("SIGTERM", handleShutdown)
}

main()