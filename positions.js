import { sellToken, calculateDynamicSlippage, reclaimRent } from './executor.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { sendAlert } from './telegram.js';
import { PoolService } from './src/services/pool.js';
import { broadcast } from './dashboard-api.js';

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs';

const POSITIONS_FILE = './logs/positions.json';
import * as PriceService from './price.js';

export class PositionManager {
  constructor() {
    this.positions = this._load();
    this.lastPrices = new Map();
    
    // Migrate existing positions - add takeProfitAt if missing
    for (const [mint, pos] of this.positions) {
      if (pos.status === 'open' && !pos.takeProfitAt) {
        pos.takeProfitAt = pos.entryPrice * CONFIG.TAKE_PROFIT_MULTIPLIER;
      }
    }
    this._save();
  }

  async clearStalePositions() {
    const now = Date.now();
    const maxAge = (CONFIG.MAX_HOLD_MINUTES || 15) * 60 * 1000;
    // Only handle positions that are clearly stale from a previous session
    // (runtime time exits are handled exclusively by checkAll)
    const BOOT_GRACE_MS = 5000; // 5s after boot — anything older is from previous run

    for (const [mint, pos] of this.positions) {
      if (pos.status !== 'open') continue;

      const age = now - pos.openedAt;
      // Skip if position is newer than maxAge + grace (will be handled by checkAll)
      if (age < maxAge + BOOT_GRACE_MS) continue;

      log('warn', `Stale position from previous session: ${mint.slice(0,8)}... (${Math.round(age/60000)}m old)`);

      // PAPER MODE: Skip Jupiter API call
      if (CONFIG.PAPER_TRADING) {
        pos.status = 'closed';
        pos.closedAt = Date.now();
        pos.closeReason = 'stale_startup';
        pos.pnlSOL = 0;
        this._save();
        log('success', `Closed stale position (paper): ${mint.slice(0,8)}...`);
        continue;
      }

      try {
        const params = new URLSearchParams({
          inputMint: mint,
          outputMint: 'So11111111111111111111111111111111111111112', // Note: Make sure address is correct
          amount: Math.floor(pos.tokenAmountOriginal - pos.totalSoldAmount).toString(),
          slippageBps: '1000'
        });

        const headers = { 'Accept': 'application/json' };
        if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

        const res = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        const quote = res.ok ? await res.json() : null;

        if (quote?.outAmount) {
          const solReceived = Number(quote.outAmount) / LAMPORTS_PER_SOL;
          pos.pnlSOL = (pos.pnlSOL || 0) + (solReceived - pos.solSpentOriginal);
          log('info', `  Stale P&L (Jupiter quote): ${pos.pnlSOL.toFixed(4)} SOL`);
        } else {
          pos.pnlSOL = 0;
          pos.status = 'stale_no_price';
          log('warn', `  No sell route — marking as stale_no_price`);
        }

        pos.status = 'closed';
        pos.closedAt = Date.now();
        pos.closeReason = 'stale';
        this._save();
        log('success', `Closed stale position: ${mint.slice(0,8)}...`);
      } catch (err) {
        log('error', `Error closing stale position ${mint.slice(0,8)}: ${err.message}`);
      }
    }
  }

  async add(mint, data) {
    const { tokenAmount, pricePerToken, solSpent, poolId, decimals } = data;
    
    const pos = {
      mint,
      poolId,
      tokenAmount,
      tokenAmountOriginal: tokenAmount,
      entryPrice: pricePerToken,
      decimals: decimals || 6,
      solSpent,
      solSpentOriginal: solSpent,
      openedAt: Date.now(),
      stopLossAt: pricePerToken * (1 - CONFIG.STOP_LOSS_PERCENT / 100),
      takeProfitAt: pricePerToken * CONFIG.TAKE_PROFIT_MULTIPLIER,
      status: 'open',
      sellStages: CONFIG.SELL_STAGES.map(s => ({ ...s, sold: false })),
      totalSoldPercent: 0,
      totalSoldAmount: 0,
    };

    this.positions.set(mint, pos);
    this._save();
    broadcast('positions', Array.from(this.positions.values()));

    const stageInfo = pos.sellStages.map(s => `${s.multiplier}x (${s.percent}%)`).join(', ');
    log('trade', `Position opened: ${mint.slice(0, 8)}...`, {
      spent: `${solSpent} SOL`,
      stages: stageInfo,
      stopLoss: `${pos.stopLossAt.toExponential(3)} SOL`,
    });

    return pos;
  }

  get(mint) {
    return this.positions.get(mint);
  }

  count() {
    return [...this.positions.values()].filter(p => p.status === 'open').length;
  }

  getOpenPositions() {
    return [...this.positions.entries()].filter(([, p]) => p.status === 'open');
  }

  async checkAll() {
    for (const [mint, pos] of this.positions) {
      if (pos.status !== 'open') continue;
      try {
        const remainingAmount = Math.floor(pos.tokenAmountOriginal - (pos.totalSoldAmount || 0));
        let currentPrice = await PriceService.getTokenPriceInSOL(mint, pos.poolId, true, remainingAmount, pos.decimals || 9);
        if (!currentPrice) {
          log('info', `  ${mint}... | Waiting for price data...`);
          continue;
        }

        // 15-minute max hold timeout
        const timeOpen = Date.now() - pos.openedAt;
        const maxHoldMs = (CONFIG.MAX_HOLD_MINUTES || 15) * 60 * 1000;
        if (timeOpen > maxHoldMs) {
          log('warn', `⏰ MAX HOLD (${Math.round(timeOpen/60000)}m > ${CONFIG.MAX_HOLD_MINUTES}m) — FORCE CLOSING: ${mint.slice(0,8)}...`);
          await this._closeRemaining(mint, pos, 'max_hold_exceeded');
          continue;
        }

        const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

        // Sanity check: If price jumps >100x (10000%) in a single check, log warning and double-check
        if (pnlPercent > 10000 && !pos._highPriceWarning) {
          log('warn', `⚠️ EXTREME PRICE SPIKE on ${mint.slice(0,8)}: ${currentPrice.toExponential(3)} SOL (+${pnlPercent.toFixed(1)}%). Verifying...`);
          pos._highPriceWarning = true; // Skip this check, will verify on next tick
          continue;
        }
        pos._highPriceWarning = false;

        const slPercent = CONFIG.STOP_LOSS_PERCENT;
        const actualSL = pos.entryPrice * (1 - slPercent / 100);
        
        // Stop loss: single clean condition — price dropped below threshold
        const isStopLoss = currentPrice < actualSL;

        if (isStopLoss) {
          log('warn', `🛑 STOP LOSS on ${mint}... (entry: ${pos.entryPrice.toExponential(3)}, current: ${currentPrice.toExponential(3)}, SL: ${actualSL.toExponential(3)})`);
          await this._closeRemaining(mint, pos, 'stop_loss');
          sendAlert('sell_sl', { mint, profitPercent: -CONFIG.STOP_LOSS_PERCENT, pnlSol: pos.pnlSOL });
          continue;
        }

        // Check sell mode
        if (CONFIG.SELL_MODE === 'instant') {
          const targetPrice = pos.entryPrice * CONFIG.INSTANT_TP_MULTIPLIER;
          if (currentPrice >= targetPrice) {
            log('success', `🎯 INSTANT SELL TRIGGERED: ${mint.slice(0,8)}...`);
            log('info', `  Entry: ${pos.entryPrice.toExponential(3)} | Current: ${currentPrice.toExponential(3)} | Target: ${targetPrice.toExponential(3)} (+${pnlPercent.toFixed(1)}%)`);
            
            let sellSlippageBps = CONFIG.SLIPPAGE_PERCENT * 100;
            try {
              const liqUSD = await PriceService.getPoolLiquidityUSD(pos.poolId);
              if (liqUSD > 0) sellSlippageBps = calculateDynamicSlippage(liqUSD) * 100;
            } catch (e) {}
            const result = await sellToken(mint, pos.tokenAmountOriginal - pos.totalSoldAmount, sellSlippageBps);
            const solReceived = result.solReceived || 0;
            pos.pnlSOL = (pos.pnlSOL || 0) + (solReceived - pos.solSpentOriginal);
            pos.totalSoldPercent = 100;
            pos.totalSoldAmount = pos.tokenAmountOriginal;
            pos.tokenAmount = 0; // CRITICAL: prevent double-sell
            await this._closeFully(mint, pos, 'take_profit');
            sendAlert('sell_tp', { mint, profitPercent: pnlPercent, pnlSol: pos.pnlSOL });
            continue;
          }
        } else {
          // Staged mode (original behavior)
          let soldThisCheck = false;
          for (const stage of pos.sellStages) {
            if (stage.sold) continue;

            const targetPrice = pos.entryPrice * stage.multiplier;
            if (currentPrice >= targetPrice) {
              const sellPercent = stage.percent;
              const sellAmount = pos.tokenAmountOriginal * (sellPercent / 100);
              const costOfSold = pos.solSpentOriginal * (sellPercent / 100);
              
              log('success', `🎯 TP ${stage.multiplier}x (${sellPercent}%) on ${mint}... (+${pnlPercent.toFixed(1)}%)`);
              
              let sellSlippageBps = CONFIG.SLIPPAGE_PERCENT * 100;
              try {
                const liqUSD = await PriceService.getPoolLiquidityUSD(pos.poolId);
                if (liqUSD > 0) sellSlippageBps = calculateDynamicSlippage(liqUSD) * 100;
              } catch (e) {}
              const result = await sellToken(mint, sellAmount, sellSlippageBps);
              
              stage.sold = true;
              pos.totalSoldPercent += sellPercent;
              pos.totalSoldAmount += sellAmount;
              pos.tokenAmount = pos.tokenAmountOriginal - pos.totalSoldAmount;

              const solReceived = result.solReceived || 0;
              const profitFromSale = solReceived - costOfSold;
              pos.pnlSOL = (pos.pnlSOL || 0) + profitFromSale;
              
              log('info', `  Sold ${sellPercent}% (${sellAmount.toFixed(4)} tokens) for ${solReceived.toFixed(4)} SOL (cost: ${costOfSold.toFixed(4)} SOL, profit: ${profitFromSale.toFixed(4)} SOL)`);

              if (pos.totalSoldPercent >= 100 || pos.tokenAmount <= 0) {
                log('success', `✅ All positions sold on ${mint}...`);
                await this._closeFully(mint, pos, 'take_profit');
                sendAlert('sell_tp', { mint, profitPercent: pnlPercent, pnlSol: pos.pnlSOL });
              } else {
                this._save();
                broadcast('positions', Array.from(this.positions.values()));
              }
              soldThisCheck = true;
              break;
            }
          }

          if (!soldThisCheck) {
            const prevPrice = this.lastPrices.get(mint);
            const priceChange = prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
            this.lastPrices.set(mint, currentPrice);

            const arrow = priceChange > 0 ? '▲' : priceChange < 0 ? '▼' : '─';
            const sign = pnlPercent >= 0 ? '+' : '';
            const changeSign = priceChange >= 0 ? '+' : '';
            
            log('info', `  ${mint.slice(0, 6)}... ${arrow} ${sign}${pnlPercent.toFixed(1)}% (${changeSign}${priceChange.toFixed(1)}%) | ${currentPrice.toExponential(3)}`);
          }
        }
      } catch (err) {
        log('error', `Position check error for ${mint}: ${err.message}`);
      }
    }
  }

  async forceClose(mintAddress) {
    const pos = this.positions.get(mintAddress);
    if (!pos || pos.status !== 'open') {
      log('warn', `No open position for ${mintAddress}`);
      return;
    }
    log('warn', `Force closing: ${mintAddress}...`);
    await this._closeRemaining(mintAddress, pos, 'force_close');
  }

  async closePosition(mintAddress, reason) {
    const pos = this.positions.get(mintAddress);
    if (!pos || pos.status !== 'open') return;
    await this._closeRemaining(mintAddress, pos, reason);
  }

  async _closeRemaining(mintAddress, pos, reason) {
    const unsoldCost = pos.solSpentOriginal * (pos.totalSoldPercent / 100);
    const remainingCost = pos.solSpentOriginal - unsoldCost;
    const remainingTokens = pos.tokenAmount;
    
    if (remainingTokens > 0) {
      let sellSlippageBps = CONFIG.SLIPPAGE_PERCENT * 100;
      try {
        const liqUSD = await PriceService.getPoolLiquidityUSD(pos.poolId);
        if (liqUSD > 0) sellSlippageBps = calculateDynamicSlippage(liqUSD) * 100;
      } catch (e) {}
      const result = await sellToken(mintAddress, remainingTokens, sellSlippageBps);
      
      // VERIFY SELL SUCCESS BEFORE MARKING CLOSED
      if (!result.success) {
        log('error', `Sell failed for ${mintAddress.slice(0,8)}... - keeping position open. Error: ${result.error}`);
        // Mark for retry so retryFailedCloses() can pick it up
        pos._closeFailed = true;
        this._save();
        // Don't close position - keep it open for retry
        return;
      }
      
      const solReceived = result.solReceived || 0;
      // Correct: profit = proceeds - cost basis
      const profitFromRemaining = solReceived - remainingCost;
      pos.pnlSOL = (pos.pnlSOL || 0) + profitFromRemaining;
    }
    pos.status = 'closed';
    pos.closeReason = reason;
    pos.closedAt = Date.now();
    pos.pnlPercent = ((pos.pnlSOL || 0) / pos.solSpentOriginal) * 100;
    this._save();
    broadcast('positions', Array.from(this.positions.values()));
    this._logTrade(pos);
  }

  async _closeFully(mintAddress, pos, reason) {
    // Only close if there's no token amount remaining or sell succeeded
    // If sell fails, keep position open and let monitoring retry
    
    if (pos.tokenAmount > 0) {
      // Try to sell remaining tokens first
      let sellSlippageBps = CONFIG.SLIPPAGE_PERCENT * 100;
      try {
        const liqUSD = await PriceService.getPoolLiquidityUSD(pos.poolId);
        if (liqUSD > 0) sellSlippageBps = calculateDynamicSlippage(liqUSD) * 100;
      } catch (e) {}
      const result = await sellToken(mintAddress, pos.tokenAmount, sellSlippageBps);
      
      if (!result.success) {
        log('error', `Cannot close position - sell failed: ${result.error}. Position remains open.`);
        return; // Don't close - keep monitoring
      }
      
      pos.pnlSOL = (pos.pnlSOL || 0) + result.solReceived;
      log('success', `Position closed with sell: ${result.solReceived.toFixed(4)} SOL`);
    }
    
    pos.status = 'closed';
    pos.closeReason = reason;
    pos.closedAt = Date.now();
    pos.pnlPercent = ((pos.pnlSOL || 0) / pos.solSpentOriginal) * 100;
    this._save();
    broadcast('positions', Array.from(this.positions.values()));
    this._logTrade(pos);
    
    // RECLAIM RENT: Close token account to get ~0.002 SOL back
    if (pos.status === 'closed' && !CONFIG.PAPER_TRADING) {
      reclaimRent(mintAddress).catch(e => {}); // Fire and forget
    }
  }

  async retryFailedCloses() {
    const openPositions = this.getOpenPositions();
    let retried = 0;
    
    for (const [mint, pos] of openPositions) {
      // ONLY retry positions that previously failed to close (not ALL open positions)
      if (pos._closeFailed && pos.tokenAmount > 0 && pos.status === 'open') {
        log('info', `Retrying failed close for ${mint.slice(0,8)}...`);
        pos._closeFailed = false; // Clear flag before retry
        await this.closePosition(mint, 'retry_close');
        retried++;
      }
    }
    
    return retried;
  }

  _logTrade(pos) {
    const sign = pos.pnlSOL >= 0 ? '+' : '';
    log(
      pos.pnlSOL >= 0 ? 'success' : 'error',
      `Trade closed [${pos.closeReason}]: ${sign}${pos.pnlSOL?.toFixed(4) || '0'} SOL (${sign}${pos.pnlPercent?.toFixed(1) || '0'}%)`
    );
  }

  getSummary() {
    const all = [...this.positions.values()];
    const closed = all.filter(p => p.status === 'closed');
    const open = all.filter(p => p.status === 'open');
    const wins = closed.filter(p => p.pnlSOL > 0);
    const losses = closed.filter(p => p.pnlSOL <= 0);
    const totalPnL = closed.reduce((sum, p) => sum + (p.pnlSOL || 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, p) => sum + (p.pnlSOL || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, p) => sum + (p.pnlSOL || 0), 0) / losses.length : 0;
    
    return {
      totalTrades: closed.length,
      openTrades: open.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? (wins.length / closed.length * 100) : 0,
      totalPnLSOL: totalPnL,
      avgWin,
      avgLoss,
      totalPnL,
    };
  }

  getTotalClosedPnL() {
    const all = [...this.positions.values()];
    const closed = all.filter(p => p.status === 'closed');
    return closed.reduce((sum, p) => sum + (p.pnlSOL || 0), 0);
  }

  getClosedPositionsCount() {
    const all = [...this.positions.values()];
    return all.filter(p => p.status === 'closed').length;
  }

  _load() {
    try {
      if (fs.existsSync(POSITIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
        return new Map(Object.entries(data));
      }
    } catch {}
    return new Map();
  }

  _save() {
    fs.writeFileSync(
      POSITIONS_FILE,
      JSON.stringify(Object.fromEntries(this.positions), null, 2)
    );
  }
}