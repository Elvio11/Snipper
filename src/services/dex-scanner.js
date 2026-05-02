import { dexService } from './dexscreener-service.js';
import { CONFIG } from '../../config.js';
import { log } from '../../logger.js';
import { PositionManager } from '../../positions.js';
import { buyToken } from '../../executor.js';

class DexScanner {
  constructor() {
    this._timer = null;
    this._candidates = new Map();
    this._processed = new Set();
    this._running = false;
    this._positions = null;
  }

  setPositions(positions) {
    this._positions = positions;
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
      if (this._processed.has(pair.pairAddress)) continue;

      if (pair.chainId !== 'solana') continue;
      if (this._isStablecoin(pair)) continue;

      const liquidity = pair.liquidity?.usd || 0;
      const volume = pair.volume?.h24 || 0;
      const txns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);

      if (liquidity < CONFIG.SCANNER_MIN_LIQUIDITY) continue;
      if (volume < CONFIG.SCANNER_MIN_VOLUME) continue;
      if (txns < CONFIG.SCANNER_MIN_TXNS) continue;

      const score = this._calculateScore(pair, liquidity, volume, txns);
      
      if (score >= CONFIG.SCANNER_SCORE_THRESHOLD) {
        scored.push({ pair, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, CONFIG.SCANNER_MAX_CANDIDATES).map(s => s.pair);
  }

  _calculateScore(pair, liquidity, volume, txns) {
    const liqScore = Math.log10(liquidity + 1) * 10;
    const volScore = Math.log10(volume + 1) * 8;
    const txnScore = Math.min(txns, 100) * 0.2;
    
    const rawScore = (liqScore * 0.4) + (volScore * 0.3) + (txnScore * 0.1);
    
    const createdAt = pair.pairCreatedAt ? pair.pairCreatedAt : Date.now() - 60000;
    const ageSeconds = (Date.now() - createdAt) / 1000;
    const recencyBonus = Math.max(0, 20 - (ageSeconds / 60));
    
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

    if (this._positions && this._positions.get(tokenMint)) {
      log('debug', `DexScanner: ${tokenMint.slice(0,8)} already in position`);
      return;
    }

    this._processed.add(poolAddress);
    setTimeout(() => this._processed.delete(poolAddress), 60000);

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

    const score = this._scoreCandidate(pair);
    log('snipe', `DexScanner BUY signal: ${tokenMint.slice(0,8)}... score=${score}`);

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