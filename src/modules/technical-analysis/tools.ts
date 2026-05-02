/**
 * Technical Analysis MCP Tools
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { fetchOHLCV } from "@/utils/coingecko-ohlcv.js"
import * as indicators from "./indicators.js"

export function registerTechnicalAnalysisTools(server: McpServer) {
  // Common parameters
  const baseParams = {
    symbol: z.string().describe("Trading symbol (e.g., BTC, ETH)"),
    interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]).default("1h").describe("Candle interval"),
    limit: z.number().default(100).describe("Number of candles to use for calculation"),
  }

  // RSI Tool
  server.tool(
    "ta_rsi",
    "Calculate Relative Strength Index (RSI) for a symbol",
    {
      ...baseParams,
      period: z.number().default(14).describe("RSI period"),
    },
    async ({ symbol, interval, limit, period }) => {
      try {
        const endTime = Date.now()
        const intervalMs = {
          "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000, "1w": 604800000
        }[interval]
        const startTime = endTime - (limit + period + 20) * intervalMs
        
        const candles = await fetchOHLCV(symbol, startTime, endTime, interval)
        if (candles.length < period) {
          throw new Error(`Not enough data for RSI. Need ${period}, got ${candles.length}`)
        }

        const rsiValues = indicators.calculateRSI(candles, period)
        const lastValue = rsiValues[rsiValues.length - 1]

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              interval,
              indicator: "RSI",
              period,
              currentValue: lastValue,
              signal: lastValue > 70 ? "Overbought" : lastValue < 30 ? "Oversold" : "Neutral",
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
          isError: true
        }
      }
    }
  )

  // MACD Tool
  server.tool(
    "ta_macd",
    "Calculate Moving Average Convergence Divergence (MACD)",
    {
      ...baseParams,
      fast: z.number().default(12).describe("Fast period"),
      slow: z.number().default(26).describe("Slow period"),
      signal: z.number().default(9).describe("Signal period"),
    },
    async ({ symbol, interval, limit, fast, slow, signal }) => {
      try {
        const endTime = Date.now()
        const intervalMs = 3600000 // default 1h
        const startTime = endTime - (limit + slow + 50) * 3600000
        
        const candles = await fetchOHLCV(symbol, startTime, endTime, interval)
        const macdResult = indicators.calculateMACD(candles, fast, slow, signal)
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              interval,
              indicator: "MACD",
              params: { fast, slow, signal },
              current: {
                macd: macdResult.macdLine.slice(-1)[0],
                signal: macdResult.signalLine.slice(-1)[0],
                histogram: macdResult.histogram.slice(-1)[0],
              },

              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
          isError: true
        }
      }
    }
  )

  // Bollinger Bands Tool
  server.tool(
    "ta_bb",
    "Calculate Bollinger Bands",
    {
      ...baseParams,
      period: z.number().default(20).describe("Period"),
      stdDev: z.number().default(2).describe("Standard Deviation"),
    },
    async ({ symbol, interval, limit, period, stdDev }) => {
      try {
        const endTime = Date.now()
        const startTime = endTime - (limit + period + 20) * 3600000
        const candles = await fetchOHLCV(symbol, startTime, endTime, interval)
        const bbResult = indicators.calculateBB(candles, period, stdDev)
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              interval,
              indicator: "Bollinger Bands",
              current: {
                upper: bbResult.upper.slice(-1)[0],
                middle: bbResult.middle.slice(-1)[0],
                lower: bbResult.lower.slice(-1)[0],
              },
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
          isError: true
        }
      }
    }
  )

  // Summary Analysis Tool
  server.tool(
    "ta_summary",
    "Get comprehensive technical analysis summary",
    {
      symbol: z.string().describe("Trading symbol"),
      interval: z.enum(["1h", "4h", "1d"]).default("1h").describe("Interval"),
    },
    async ({ symbol, interval }) => {
      try {
        const endTime = Date.now()
        const startTime = endTime - 300 * (interval === "1h" ? 3600000 : interval === "4h" ? 14400000 : 86400000)
        const candles = await fetchOHLCV(symbol, startTime, endTime, interval)
        const analysis = indicators.getComprehensiveAnalysis(candles)
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              interval,
              analysis,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
          isError: true
        }
      }
    }
  )
}
