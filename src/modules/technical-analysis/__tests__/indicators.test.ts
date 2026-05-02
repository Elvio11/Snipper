import { describe, it, expect } from 'vitest'
import { calculateRSI, calculateMA, calculateMACD } from '../indicators.js'
import { Candle } from '@/utils/coingecko-ohlcv.js'

describe('Technical Indicators', () => {
  const mockCandles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
    timestamp: Date.now() - (50 - i) * 3600000,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 100 + i + (i % 2 === 0 ? 2 : -2),
    volume: 1000
  }))

  it('calculates RSI correctly', () => {
    const rsiValues = calculateRSI(mockCandles, 14)
    expect(rsiValues).toBeDefined()
    expect(rsiValues.length).toBeLessThanOrEqual(mockCandles.length)
    expect(rsiValues[rsiValues.length - 1]).toBeGreaterThan(0)
    expect(rsiValues[rsiValues.length - 1]).toBeLessThan(100)
  })

  it('calculates SMA and EMA', () => {
    const smaValues = calculateMA(mockCandles, 20, 'sma')
    const emaValues = calculateMA(mockCandles, 20, 'ema')
    
    expect(smaValues).toBeDefined()
    expect(emaValues).toBeDefined()
    expect(smaValues.length).toBeLessThanOrEqual(mockCandles.length)
    expect(emaValues.length).toBeLessThanOrEqual(mockCandles.length)
  })

  it('calculates MACD', () => {
    const macdResult = calculateMACD(mockCandles)
    expect(macdResult).toHaveProperty('macdLine')
    expect(macdResult).toHaveProperty('signalLine')
    expect(macdResult).toHaveProperty('histogram')
    expect(macdResult.macdLine.length).toBeLessThanOrEqual(mockCandles.length)
  })

})
