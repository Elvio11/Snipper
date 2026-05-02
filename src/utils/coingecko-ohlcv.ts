/**
 * CoinGecko OHLCV Utility
 */

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Map symbols to CoinGecko IDs
export const symbolToId: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  AVAX: 'avalanche-2',
  ATOM: 'cosmos',
  DOT: 'polkadot',
  LINK: 'chainlink',
  UNI: 'uniswap',
  MATIC: 'matic-network',
  NEAR: 'near',
  SUI: 'sui',
  APT: 'aptos',
}

/**
 * Fetch real OHLCV data from CoinGecko
 */
export async function fetchOHLCV(
  symbol: string,
  startTime: number,
  endTime: number,
  interval: string
): Promise<Candle[]> {
  const coinId = symbolToId[symbol.toUpperCase()]
  if (!coinId) {
    throw new Error(`Unknown symbol: ${symbol}. Available: ${Object.keys(symbolToId).join(', ')}`);
  }

  // Map interval to CoinGecko days parameter
  const intervalDays: Record<string, number> = {
    "1m": 1,
    "5m": 1,
    "15m": 1,
    "1h": 7,
    "4h": 30,
    "1d": 90,
    "1w": 365,
  }

  const days = intervalDays[interval] || 7
  const apiKey = process.env.COINGECKO_API_KEY
  const baseUrl = apiKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3'

  const url = `${baseUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  if (apiKey) {
    headers['x-cg-pro-api-key'] = apiKey
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.statusText}`);
  }

  const rawData = await response.json() as Array<[number, number, number, number, number]>

  // Convert CoinGecko format [timestamp, open, high, low, close] to our format
  const data = rawData
    .filter(candle => {
      const ts = candle[0]
      return ts >= startTime && ts <= endTime
    })
    .map(candle => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: 0, // CoinGecko OHLC endpoint doesn't include volume
    }))

  return data
}
