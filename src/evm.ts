/**
 * MemeTrader Analytics Hub - EVM Module Registration
 * Analytics-only: market data, DEX analytics, portfolio, security, tokens
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

// Core data modules (KEEP - these work)
import { registerDefi } from "@/modules/defi/index.js"
import { registerDexAnalytics } from "@/modules/dex-analytics/index.js"
import { registerMarketData } from "@/modules/market-data/index.js"
import { registerCoinGecko } from "@/modules/coingecko/index.js"
import { registerWalletAnalytics } from "@/modules/wallet-analytics/index.js"
import { registerHistoricalData } from "@/modules/historical-data/index.js"

/**
 * Register Analytics-only modules with the MCP server
 */
export function registerAnalytics(server: McpServer) {
  // Data/Analytics modules
  registerDefi(server)
  registerDexAnalytics(server)
  registerMarketData(server)
  registerCoinGecko(server)
  registerHistoricalData(server)
  registerWalletAnalytics(server)
}