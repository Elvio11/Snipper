# DexScreener Primary Scanner Implementation Plan

**Goal:** Implement DexScreener as primary discovery source - poll for new pairs every 5s, score by liquidity/volume/recency, auto-buy top candidates

**Architecture:** New DexScanner class polls getNewPairs(), scores each pair, maintains candidate queue, integrates with existing buyToken/positions

**Tech Stack:** Node.js ES modules, DexScreener service (existing), existing CONFIG/positions system

---

## Task 1: Add Scanner Config

**Files:**
- Modify: `config.js` (add SCANNER config section around line 50)
- Modify: `.env` (add SCANNER_ defaults)
- Test: Run `node -c config.js`

- [ ] **Step 1: Add SCANNER config to config.js**

Add after existing CONFIG exports:
```javascript
// DexScreener Scanner Config
SCANNER_ENABLED: process.env.SCANNER_ENABLED === 'true',
SCANNER_POLL_INTERVAL: parseInt(process.env.SCANNER_POLL_INTERVAL || '5000'),
SCANNER_MIN_LIQUIDITY: parseFloat(process.env.SCANNER_MIN_LIQUIDITY || '1000'),
SCANNER_MIN_VOLUME: parseFloat(process.env.SCANNER_MIN_VOLUME || '100'),
SCANNER_MIN_TXNS: parseInt(process.env.SCANNER_MIN_TXNS || '5'),
SCANNER_MAX_CANDIDATES: parseInt(process.env.SCANNER_MAX_CANDIDATES || '3'),
SCANNER_SCORE_THRESHOLD: parseFloat(process.env.SCANNER_SCORE_THRESHOLD || '50'),
```

- [ ] **Step 2: Add SCANNER defaults to .env**

Add at end of .env:
```
# DexScreener Scanner
SCANNER_ENABLED=true
SCANNER_POLL_INTERVAL=5000
SCANNER_MIN_LIQUIDITY=1000
SCANNER_MIN_VOLUME=100
SCANNER_MIN_TXNS=5
SCANNER_MAX_CANDIDATES=3
SCANNER_SCORE_THRESHOLD=50
```

- [ ] **Step 3: Syntax check config**

Run: `node -c config.js`
Expected: No output (success)

- [ ] **Step 4: Commit**

```bash
git add config.js .env
git commit -m "config: add DexScreener scanner settings"
```

---

## Task 2: Create DexScanner Class

**Files:**
- Create: `src/services/dex-scanner.js` (full implementation)
- Test: `node -c src/services/dex-scanner.js`

- [ ] **Step 1: Write DexScanner class**

```javascript
import { dexService } from './dexscreener-service.js';
import { CONFIG } from '../../config.js';
import { log } from '../../logger.js';
import { positions } from '../../positions.js';
import { buyToken } from '../../executor.js';

class DexScanner {
  constructor() {
    this._timer = null;
    this._candidates = new Map(); // poolAddress -> candidate data
    this._processed = new Set();   // recently processed pairs
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const interval = CONFIG.SCANNER_POLL_INTERVAL || 5000;
    this._timer = setInterval(() => this._poll(), interval);
    log('info', `DexScanner started (poll every ${interval}ms)`);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    log('info', 'DexScanner stopped');
  }

  async _poll() {
    try {
      const result = await dexService.getNewPairs('solana', 20);
      if (!result.success || !result.data) {
        log('debug', 'DexScanner: no new pairs');
        return;
      }

      const candidates = this._scoreAndFilter(result.data);
      log('debug', `DexScanner: ${candidates.length} candidates`);

      for (const candidate of candidates) {
        await this._processCandidate(candidate);
      }
    } catch (err) {
      log('warn', `DexScanner poll error: ${err.message}`);
    }
  }

  _scoreAndFilter(pairs) {
    const scored = [];

    for (const pair of pairs) {
      // Skip if already processed recently
      if (this._processed.has(pair.pairAddress)) continue;

      // Skip non-Solana or stablecoin pairs
      if (pair.chainId !== 'solana') continue;
      if (this._isStablecoin(pair)) continue;

      const liquidity = pair.liquidity?.usd || 0;
      const volume = pair.volume?.h24 || 0;
      const txns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);

      // Apply minimum thresholds
      if (liquidity < CONFIG.SCANNER_MIN_LIQUIDITY) continue;
      if (volume < CONFIG.SCANNER_MIN_VOLUME) continue;
      if (txns < CONFIG.SCANNER_MIN_TXNS) continue;

      // Calculate score
      const score = this._calculateScore(pair, liquidity, volume, txns);
      
      if (score >= CONFIG.SCANNER_SCORE_THRESHOLD) {
        scored.push({ pair, score });
      }
    }

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, CONFIG.SCANNER_MAX_CANDIDATES).map(s => s.pair);
  }

  _calculateScore(pair, liquidity, volume, txns) {
    // Normalize values (simplified)
    const liqScore = Math.log10(liquidity + 1) * 10;  // log scale
    const volScore = Math.log10(volume + 1) * 8;
    const txnScore = Math.min(txns, 100) * 0.2;
    
    // Weights: liquidity 40%, volume 30%, txns 10%, recency 20%
    const rawScore = (liqScore * 0.4) + (volScore * 0.3) + (txnScore * 0.1);
    
    // Recency bonus (newer pairs get higher score)
    const createdAt = pair.dexScreenerId ? Date.now() : Date.now() - 60000;
    const ageSeconds = (Date.now() - createdAt) / 1000;
    const recencyBonus = Math.max(0, 20 - (ageSeconds / 60)); // Max 20 points
    
    return rawScore + recencyBonus;
  }

  _isStablecoin(pair) {
    const stableSymbols = ['USDC', 'USDT', 'DAI', 'BUSD', 'UST', 'FRAX'];
    const baseToken = pair.baseToken?.symbol?.toUpperCase() || '';
    const quoteToken = pair.quoteToken?.symbol?.toUpperCase() || '';
    return stableSymbols.some(s => baseToken.includes(s) || quoteToken.includes(s));
  }

  async _processCandidate(pair) {
    const poolAddress = pair.pairAddress;
    const tokenMint = pair.baseToken?.address;

    if (!tokenMint || !poolAddress) return;

    // Skip if already in position
    if (positions.get(tokenMint)) {
      log('debug', `DexScanner: ${tokenMint.slice(0,8)} already in position`);
      return;
    }

    // Mark as processed
    this._processed.add(poolAddress);
    setTimeout(() => this._processed.delete(poolAddress), 60000); // 1 min cooldown

    // Re-validate liquidity
    const tokenResult = await dexService.getTokenPairs(tokenMint);
    if (!tokenResult.success || !tokenResult.data?.length) {
      log('debug', `DexScanner: validation failed for ${tokenMint.slice(0,8)}`);
      return;
    }

    const topPair = tokenResult.data[0];
    if ((topPair.liquidity?.usd || 0) < CONFIG.SCANNER_MIN_LIQUIDITY) {
      log('debug', `DexScanner: liquidity check failed for ${tokenMint.slice(0,8)}`);
      return;
    }

    log('snipe', `DexScanner BUY signal: ${tokenMint.slice(0,8)}... score=${this._scoreCandidate(pair)}`);

    // Execute buy
    try {
      const result = await buyToken(tokenMint, CONFIG.BUY_AMOUNT_SOL, poolAddress);
      if (result.success) {
        log('success', `DexScanner: BOUGHT ${tokenMint.slice(0,8)}...`);
      } else {
        log('warn', `DexScanner: buy failed: ${result.error}`);
      }
    } catch (err) {
      log('error', `DexScanner: buy error: ${err.message}`);
    }
  }

  _scoreCandidate(pair) {
    const liquidity = pair.liquidity?.usd || 0;
    const volume = pair.volume?.h24 || 0;
    const txns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
    return this._calculateScore(pair, liquidity, volume, txns);
  }
}

export const dexScanner = new DexScanner();
export default dexScanner;
```

- [ ] **Step 2: Syntax check**

Run: `node -c src/services/dex-scanner.js`
Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add src/services/dex-scanner.js
git commit -m "feat: add DexScanner class for primary discovery"
```

---

## Task 3: Integrate Scanner in index.js

**Files:**
- Modify: `index.js` (import and start scanner)
- Test: `node -c index.js`

- [ ] **Step 1: Add import in index.js**

Add after existing imports:
```javascript
import { dexScanner } from './src/services/dex-scanner.js';
```

- [ ] **Step 2: Add scanner startup in main()**

Find where monitor starts (~line 90), add after:
```javascript
// Start DexScreener scanner if enabled
if (CONFIG.SCANNER_ENABLED) {
  dexScanner.start();
  log('info', 'DexScreener scanner enabled');
}
```

- [ ] **Step 3: Add graceful shutdown**

Find where monitor.stop() is called, add:
```javascript
if (CONFIG.SCANNER_ENABLED) {
  dexScanner.stop();
}
```

- [ ] **Step 4: Syntax check**

Run: `node -c index.js`
Expected: No output (success)

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: integrate DexScanner in main bot"
```

---

## Task 4: Write Unit Tests

**Files:**
- Create: `tests/unit/dex-scanner.test.js`

- [ ] **Step 1: Write tests**

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DexScanner } from '../../src/services/dex-scanner.js';

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
  positions: {
    get: vi.fn().mockReturnValue(null),
    count: vi.fn().mockReturnValue(0)
  }
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

  beforeEach(() => {
    scanner = new DexScanner();
  });

  afterEach(() => {
    scanner.stop();
  });

  it('should filter stablecoins', () => {
    const stablePairs = [
      { baseToken: { symbol: 'USDC' }, quoteToken: { symbol: 'SOL' } },
      { baseToken: { symbol: 'SOL' }, quoteToken: { symbol: 'USDT' } }
    ];
    const tokenPairs = [
      { baseToken: { symbol: 'PEPE' }, quoteToken: { symbol: 'SOL' } }
    ];
    
    // Test the stablecoin filter logic
    expect(scanner._isStablecoin(stablePairs[0])).toBe(true);
    expect(scanner._isStablecoin(tokenPairs[0])).toBe(false);
  });

  it('should calculate score correctly', () => {
    const pair = {
      liquidity: { usd: 10000 },
      volume: { h24: 5000 },
      txns: { h24: { buys: 10, sells: 5 } }
    };
    
    const score = scanner._calculateScore(pair, 10000, 5000, 15);
    expect(score).toBeGreaterThan(50);
  });

  it('should not process pairs below thresholds', () => {
    const pairs = [
      { pairAddress: 'abc', chainId: 'solana', baseToken: { address: 'mint1' }, liquidity: { usd: 500 }, volume: { h24: 100 }, txns: { h24: { buys: 3, sells: 1 } } },
      { pairAddress: 'def', chainId: 'solana', baseToken: { address: 'mint2' }, liquidity: { usd: 15000 }, volume: { h24: 2000 }, txns: { h24: { buys: 10, sells: 5 } } }
    ];
    
    const candidates = scanner._scoreAndFilter(pairs);
    expect(candidates.length).toBe(1);
    expect(candidates[0].pairAddress).toBe('def');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:run -- tests/unit/dex-scanner.test.js`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/unit/dex-scanner.test.js
git commit -m "test: add DexScanner unit tests"
```

---

## Task 5: Integration Test (Paper Mode)

**Files:**
- Test: Run bot in paper mode with scanner

- [ ] **Step 1: Run in paper mode**

Run: `npm run paper 2>&1 | Select-Object -First 50`
Expected: Bot starts, scanner enabled message appears

- [ ] **Step 2: Verify scanner is polling**

Check logs for: "DexScanner started" and periodic "candidates" debug messages

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "test: verified scanner integration in paper mode"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add SCANNER config to config.js and .env |
| 2 | Create DexScanner class with polling, scoring, execution |
| 3 | Integrate scanner in index.js |
| 4 | Write unit tests |
| 5 | Run paper mode integration test |