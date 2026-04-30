import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config.js', () => ({
  CONFIG: {
    SCANNER_ENABLED: true,
    SCANNER_POLL_INTERVAL: 100,
    SCANNER_MIN_LIQUIDITY: 1000,
    SCANNER_MIN_VOLUME: 100,
    SCANNER_MIN_TXNS: 5,
    SCANNER_MAX_CANDIDATES: 3,
    SCANNER_SCORE_THRESHOLD: 50,
    BUY_AMOUNT_SOL: 0.01,
  }
}));

vi.mock('../../logger.js', () => ({
  log: vi.fn()
}));

vi.mock('../../positions.js', () => ({
  PositionManager: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue(null),
    count: vi.fn().mockReturnValue(0)
  }))
}));

vi.mock('../../executor.js', () => ({
  buyToken: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../../src/services/dexscreener-service.js', () => ({
  dexService: {
    getNewPairs: vi.fn(),
    getTokenPairs: vi.fn()
  }
}));

describe('DexScanner', () => {
  let scanner;

  beforeEach(async () => {
    const { default: scannerInstance } = await import('../../src/services/dex-scanner.js');
    scanner = scannerInstance;
  });

  afterEach(() => {
    scanner?.stop();
  });

  it('should filter stablecoins', () => {
    const stablePairs = [
      { baseToken: { symbol: 'USDC' }, quoteToken: { symbol: 'SOL' } },
      { baseToken: { symbol: 'SOL' }, quoteToken: { symbol: 'USDT' } }
    ];
    const tokenPairs = [
      { baseToken: { symbol: 'PEPE' }, quoteToken: { symbol: 'SOL' } }
    ];

    expect(scanner._isStablecoin(stablePairs[0])).toBe(true);
    expect(scanner._isStablecoin(stablePairs[1])).toBe(true);
    expect(scanner._isStablecoin(tokenPairs[0])).toBe(false);
  });

  it('should calculate score correctly', () => {
    const pair = {
      liquidity: { usd: 100000 },
      volume: { h24: 20000 },
      txns: { h24: { buys: 30, sells: 20 } }
    };

    const score = scanner._calculateScore(pair, 100000, 20000, 50);
    expect(score).toBeGreaterThan(50);
  });

  it('should not process pairs below thresholds', () => {
    const pairs = [
      { pairAddress: 'abc', chainId: 'solana', baseToken: { address: 'mint1' }, liquidity: { usd: 500 }, volume: { h24: 100 }, txns: { h24: { buys: 3, sells: 1 } } },
      { pairAddress: 'def', chainId: 'solana', baseToken: { address: 'mint2' }, liquidity: { usd: 100000 }, volume: { h24: 20000 }, txns: { h24: { buys: 30, sells: 20 } } }
    ];

    const candidates = scanner._scoreAndFilter(pairs);
    expect(candidates.length).toBe(1);
    expect(candidates[0].pairAddress).toBe('def');
  });
});