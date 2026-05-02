/**
 * Technical Analysis Indicators
 * Wrapper for indicatorts library
 */
import { 
  sma, 
  ema, 
  rsi, 
  macd, 
  bb, 
  atr,
  mfi,
  obv,
  vwap,
  williamsr,
  stoch,
} from 'indicatorts'
import { Candle } from '@/utils/coingecko-ohlcv.js'

export interface IndicatorResult {
  symbol: string
  interval: string
  indicator: string
  values: any
  timestamp: string
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(candles: Candle[], period: number = 14) {
  const closes = candles.map(c => c.close)
  return rsi(closes, period)
}

/**
 * Calculate Moving Averages (SMA & EMA)
 */
export function calculateMA(candles: Candle[], period: number = 20, type: 'sma' | 'ema' = 'sma') {
  const closes = candles.map(c => c.close)
  return type === 'sma' ? sma(closes, period) : ema(closes, period)
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  candles: Candle[], 
  fast: number = 12, 
  slow: number = 26, 
  signal: number = 9
) {
  const closes = candles.map(c => c.close)
  const result = macd(closes, fast, slow, signal)
  const histogram = result.macdLine.map((val, i) => val - result.signalLine[i])
  return {
    ...result,
    histogram
  }
}


/**
 * Calculate Bollinger Bands
 */
export function calculateBB(candles: Candle[], period: number = 20, stdDev: number = 2) {
  const closes = candles.map(c => c.close)
  return bb(closes, period, stdDev)
}

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(candles: Candle[], period: number = 14) {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  return atr(highs, lows, closes, period)
}

/**
 * Calculate MFI (Money Flow Index)
 */
export function calculateMFI(candles: Candle[], period: number = 14) {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  return mfi(highs, lows, closes, volumes, period)
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 */
export function calculateVWAP(candles: Candle[]) {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  return vwap(highs, lows, closes, volumes)
}

/**
 * Get comprehensive analysis (Multiple indicators)
 */
export function getComprehensiveAnalysis(candles: Candle[]) {
  const lastCandle = candles[candles.length - 1]
  const lastPrice = lastCandle.close

  const rsiValue = calculateRSI(candles).slice(-1)[0]
  const macdResult = calculateMACD(candles)
  const lastMACD = macdResult.macdLine.slice(-1)[0]
  const lastSignal = macdResult.signalLine.slice(-1)[0]
  const lastHist = macdResult.histogram.slice(-1)[0]

  
  const bbResult = calculateBB(candles)
  const lastUpper = bbResult.upper.slice(-1)[0]
  const lastLower = bbResult.lower.slice(-1)[0]
  const lastMiddle = bbResult.middle.slice(-1)[0]

  const sma50 = calculateMA(candles, 50, 'sma').slice(-1)[0]
  const sma200 = calculateMA(candles, 200, 'sma').slice(-1)[0]

  // Trend determination
  let trend = 'neutral'
  if (lastPrice > sma50 && sma50 > sma200) trend = 'bullish'
  else if (lastPrice < sma50 && sma50 < sma200) trend = 'bearish'

  // RSI signal
  let rsiSignal = 'neutral'
  if (rsiValue > 70) rsiSignal = 'overbought'
  else if (rsiValue < 30) rsiSignal = 'oversold'

  return {
    price: lastPrice,
    rsi: rsiValue,
    rsiSignal,
    macd: {
      value: lastMACD,
      signal: lastSignal,
      histogram: lastHist,
      crossover: lastMACD > lastSignal ? 'bullish' : 'bearish'
    },
    bollingerBands: {
      upper: lastUpper,
      middle: lastMiddle,
      lower: lastLower,
      position: (lastPrice - lastLower) / (lastUpper - lastLower)
    },
    movingAverages: {
      sma50,
      sma200,
      goldenCross: sma50 > sma200,
    },
    summary: {
      trend,
      strength: Math.abs(50 - rsiValue) / 50, // 0 to 1
    }
  }
}
