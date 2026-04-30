import 'dotenv/config';
import chalk from 'chalk';
import fs from 'fs';
import { CONFIG, validateConfig, getDynamicBuyAmount, setSolPrice } from './config.js';
import { log } from './logger.js';
import { getWallet, getSignerWallet, printWalletInfo, getSOLBalance, getVaultBalance, refillSignerFromVault, getSolPrice } from './wallet.js';
import { PoolMonitor } from './monitor.js';
import { analyzeToken } from './safety.js';
import { buyToken } from './executor.js';
import { PositionManager } from './positions.js';
import { PoolService } from './src/services/pool.js';
import { getTokenPriceInSOL, getPoolLiquidityUSD, getPriceFromPool } from './price.js';
import { initTelegram, sendAlert, setPositionManager } from './telegram.js';
import { shinobiWS } from './shinobi-ws.js';


// ─── Global Error Handlers ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  log('error', ` Uncaught Exception: ${err.message}`);
  log('error', err.stack);
  sendAlert('error', { message: `Uncaught Exception: ${err.message}` });
  setTimeout(() => process.exit(1), 5000);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', `Unhandled Rejection at: ${promise}, reason: ${reason}`);
  sendAlert('error', { message: `Unhandled Rejection: ${reason}` });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
let isShuttingDown = false;
let monitor = null;
let positions = null;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  log('info', ` ${signal} received - Starting graceful shutdown...`);
  
  try {
    if (monitor) {
      log('info', 'Stopping pool monitor...');
      await monitor.stop();
    }

    if (positions) {
      log('info', 'Saving open positions...');
      positions._save();
    }
    
    log('info', 'Shutdown complete. Goodbye!');
    process.exit(0);
  } catch (err) {
    log('error', `Shutdown error: ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Banner ──────────────────────────────────────────────────────────────────

function printBanner() {
  console.log(chalk.yellow('\n' + '═'.repeat(56)));
  console.log(chalk.yellow('  ⚡  SOLANA MEME SNIPER BOT'));
  console.log(chalk.yellow('═'.repeat(56)));
  if (CONFIG.PAPER_TRADING) {
    console.log(chalk.bgMagenta.white('  PAPER TRADING MODE — No real funds at risk  '));
  } else {
    console.log(chalk.bgRed.white('  ⚠  LIVE TRADING — Real funds at risk         '));
  }
  console.log(chalk.yellow('═'.repeat(56) + '\n'));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // Validate config
  const errors = validateConfig();
  if (errors.length > 0) {
    errors.forEach(e => log('error', e));
    process.exit(1);
  }

  // Print wallet info
  await printWalletInfo();
  
  if (CONFIG.USE_GRADUATED_SCALING) {
    log('success', `📈 GRADUATED SCALING ENABLED`);
    log('info', `  Phases: $5→20%=1, $10→30%=2, $20→50%=3, $50→70%=4`);
    log('info', `  Cap: $${CONFIG.SCALING_MAX_BALANCE}`);
  } else {
    log('info', `Buy per trade:   ${CONFIG.BUY_AMOUNT_SOL} SOL`);
  }
  log('info', `Take profit:     ${CONFIG.TAKE_PROFIT_MULTIPLIER}x`);
  log('info', `Stop loss:       ${CONFIG.STOP_LOSS_PERCENT}%`);
  log('info', `Max positions:   ${CONFIG.MAX_POSITIONS}`);
  log('info', `Signer wallet:   ${getSignerWallet().publicKey.toString().slice(0, 8)}...`);
  console.log();

  // Init Telegram
  initTelegram();

  positions = new PositionManager();
  await positions.clearStalePositions();
  setPositionManager(positions);

  monitor   = new PoolMonitor();
  let isBuying = false;
  let isSwapping = false;
  let buyingTimeout = null;
  const BUY_TIMEOUT_MS = 15000;

  function resetBuying() {
    if (buyingTimeout) {
      clearTimeout(buyingTimeout);
      buyingTimeout = null;
    }
    isBuying = false;
  }

  // ─── New pool handler ───────────────────────────────────────────────────
  monitor.on('newPool', async (poolInfo) => {
    const { tokenMint, poolId, liquidityUSD } = poolInfo;

    // Guard 1: Max positions check FIRST
    if (positions.count() >= CONFIG.MAX_POSITIONS) {
      if (positions.count() < CONFIG.MAX_POSITIONS) {
        log('snipe', `New pool: ${tokenMint.slice(0, 12)}...  Pool: ${poolId.slice(0, 8)}...`);
      }
      log('info', `⚠ Max positions (${CONFIG.MAX_POSITIONS}) — monitoring but NOT buying new tokens`);
      return;
    }

    // Log new pool (we're under max)
    log('snipe', `New pool: ${tokenMint.slice(0, 12)}...  Pool: ${poolId.slice(0, 8)}...`);

    // Guard 2: Prevent re-buying existing positions
    if (positions.get(tokenMint) && positions.get(tokenMint).status === 'open') {
      log('warn', `Already have position for ${tokenMint.slice(0, 8)}... — skipping`);
      return;
    }

    if (isBuying) {
      log('warn', `Already buying — skipping`);
      return;
    }
    if (isSwapping) {
      log('warn', 'Transaction already in progress...');
      return;
    }
    isBuying = true;
    buyingTimeout = setTimeout(() => {
      if (isBuying) {
        log('warn', 'Buy timeout - resetting lock');
        resetBuying();
      }
    }, BUY_TIMEOUT_MS);

    // Start monitoring if not already
    if (!monitor.isListening()) {
      await monitor.start();
      log('info', 'Started pool monitoring');
    }

    const signerBalance = await getSOLBalance();
    const vaultBalance = await getVaultBalance();
    const totalBalance = signerBalance + vaultBalance;
    
    const closedPnL = positions.getTotalClosedPnL();
    const effectiveVault = vaultBalance + closedPnL;
    
    const buyAmount = CONFIG.USE_GRADUATED_SCALING 
      ? getDynamicBuyAmount(totalBalance, CONFIG._solPrice || 90, vaultBalance, closedPnL)
      : CONFIG.BUY_AMOUNT_SOL;
    
    const compundingMsg = closedPnL !== 0 ? ` (+${closedPnL.toFixed(4)} profit)` : '';
    log('info', `💰 Balance: ${totalBalance.toFixed(4)} SOL (S:${signerBalance.toFixed(3)} V:${vaultBalance.toFixed(3)}${compundingMsg}) | Buy: ${buyAmount.toFixed(6)} SOL`);
    
    if (totalBalance < buyAmount + 0.005) {
      log('warn', `Insufficient balance: ${totalBalance.toFixed(4)} SOL (need ${buyAmount.toFixed(4)} SOL)`);
      resetBuying();
      return;
    }

    // Unified liquidity check via PoolService
    const poolState = await PoolService.getPoolState(poolId, tokenMint);
    const finalLiquidity = poolState.tvlUSD || liquidityUSD || 0;
    
    log('info', `Pool liquidity: $${finalLiquidity.toLocaleString()} (${poolState.program})`);
    
    // FIXED: Remove > 0 check, add SOL liquidity validation
    if (finalLiquidity < CONFIG.MIN_LIQUIDITY_USD) {
      log('warn', `Liquidity too low: $${finalLiquidity}`);
      resetBuying();
      return;
    }
    
    // Check SOL liquidity via Jupiter quote (skip in paper mode)
    if (!CONFIG.PAPER_TRADING) {
      try {
        const { jupiterApi } = await import('./src/jupiter-client.js');
        const { LAMPORTS_PER_SOL } = await import('./src/jupiter-client.js');
        const solQuote = await jupiterApi.quoteGet({
          inputMint: 'So11111111111111111111111111111111111112',
          outputMint: tokenMint,
          amount: Math.floor(0.001 * LAMPORTS_PER_SOL),
          slippageBps: 5000,
        });
        
        if (!solQuote || !solQuote.outAmount) {
          log('warn', `No SOL liquidity route for ${tokenMint.slice(0,8)}... — skipping`);
          resetBuying();
          return;
        }
        
        const tokenReceived = Number(solQuote.outAmount);
        log('info', `SOL liquidity confirmed: ~${tokenReceived} tokens per 0.001 SOL`);
      } catch (err) {
        log('warn', `SOL liquidity check failed: ${err.message} — continuing anyway`);
        // Don't skip trade - continue with DexScreener/fallback price
      }
    } else {
      log('info', `SOL liquidity check skipped (PAPER_TRADING)`);
    }
    
    // Get price from price.js (with estimated fallback)
    log('info', `Fetching price for ${tokenMint.slice(0,8)}... pool: ${poolId}`);
    let currentPrice = await getTokenPriceInSOL(tokenMint, poolId);
    if (!currentPrice) {
      currentPrice = 0.000001;
      log('warn', `Price lookup failed - using liquidity-based estimate`);
      log('info', `Using estimated entry price: ${currentPrice.toExponential(4)} SOL`);
    }
    log('info', `Current price: ${currentPrice.toExponential(4)} SOL`);

    // Token security analysis via PoolService
    log('info', `Analyzing token safety: ${tokenMint.slice(0, 12)}...`);
    const security = await PoolService.getTokenSecurity(tokenMint);

    if (security.isHoneypot) {
      log('warn', `✖ Honeypot detected: ${security.honeypotReason}`);
      resetBuying();
      return;
    }

    if (security.mintAuthority) {
      log('info', `  ⚠ Mint authority NOT revoked - can print tokens`);
    }

    if (security.liquidityUSD > 0) {
      log('info', `  ✔ DexScreener liquidity: $${security.liquidityUSD.toLocaleString()}`);
    }

    const safetyScore = calculateSafetyScore(security);
    log('success', `Safety score: ${safetyScore}/100 — SNIPING 🚀`);

    if (safetyScore < 40) {
      log('warn', `Token failed safety check`);
      resetBuying();
      return;
    }

    if (!CONFIG.PAPER_TRADING) {
      const refill = await refillSignerFromVault();
      if (!refill.success) {
        log('warn', `Signer refill failed: ${refill.reason}`);
        if (refill.reason === 'vault_low') {
          sendAlert('error', { message: 'Vault balance too low for refill' });
          resetBuying();
          return;
        }
      }
    }

    isSwapping = true;
    try {
      const result = await buyToken(tokenMint, buyAmount, poolId);

      if (!result.success) {
        log('error', `Buy failed: ${result.error}`);
        resetBuying();
        return;
      }

      await positions.add(tokenMint, {
        tokenAmount: result.tokenAmount,
        pricePerToken: result.pricePerToken,
        solSpent: result.solSpent,
        poolId,
      });

      sendAlert('buy', {
        mint: tokenMint,
        solSpent: result.solSpent,
        pricePerToken: result.pricePerToken,
      });

    } catch (err) {
      log('error', `Buy error: ${err.message}`);
    } finally {
      isSwapping = false;
      resetBuying();
    }
  });

  function calculateSafetyScore(security) {
    let score = 100;
    if (security.mintAuthority) score -= 30;
    if (security.freezeAuthority) score -= 20;
    if (security.isHoneypot) score -= 100;
    if (security.liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) score -= 40;
    if (security.txns24h < 5) score -= 10;
    return Math.max(0, score);
  }

  // ─── Position monitoring loop ───────────────────────────────────────────
  let lastMonitoredPrices = {};
  let isMonitoring = false;
  let lastRetryTime = 0;
  
  setInterval(async () => {
    // PREVENT OVERLAPPING EXECUTIONS
    if (isMonitoring) return;
    isMonitoring = true;
    
    try {
      // Resume pool monitoring when positions < MAX_POSITIONS (has vacant slots)
      if (positions.count() < CONFIG.MAX_POSITIONS) {
        if (!monitor.isListening()) {
          await monitor.start();
          log('info', '══════════════════════════════════════════');
          log('info', `  🎯 DISCOVERY MODE — Scanning for new pools`);
          log('info', '══════════════════════════════════════════');
        }
      }
      
      // If all positions full, stop DISCOVERY only (not monitoring)
      if (positions.count() >= CONFIG.MAX_POSITIONS && monitor.isListening()) {
        await monitor.stop();
      }
    
    // Show monitoring header (only when positions open)
    if (positions.count() > 0) {
      log('info', '══════════════════════════════════════════');
      log('info', `  🔍 MONITORING ${positions.count()} position(s) - TP/SL checks active`);
      log('info', '══════════════════════════════════════════');
    }
    
    // Check positions and track price changes + execute TP/SL
    for (const [mint, pos] of positions.getOpenPositions()) {
      if (pos.status !== 'open') continue;
      
      // Use entry price if no fresh price available
      let currentPrice = await getTokenPriceInSOL(mint, pos.poolId);
      if (!currentPrice) {
        currentPrice = pos.entryPrice;
      }
      
      try {
        const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const prevPrice = lastMonitoredPrices[mint];
        const priceChange = prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
        
        lastMonitoredPrices[mint] = currentPrice;
        
        const sign = pnlPercent >= 0 ? '+' : '';
        const arrow = priceChange > 0 ? '▲' : priceChange < 0 ? '▼' : '─';
        const changeSign = priceChange >= 0 ? '+' : '';
        
        log('info', `  ${mint.slice(0, 6)}... ${arrow} ${sign}${pnlPercent.toFixed(1)}% (${changeSign}${priceChange.toFixed(1)}%) | ${currentPrice.toExponential(3)}`);
      } catch (err) {
        log('error', `  Price check error for ${mint.slice(0, 6)}...: ${err.message}`);
      }
    }

    // Process TP/SL for all open positions
    await positions.checkAll(async (mint, poolId) => {
      const price = await getTokenPriceInSOL(mint, poolId);
      if (!price) {
        return await getPriceFromPool(poolId);
      }
      return price;
    });
  } finally {
    isMonitoring = false;
  }
}, CONFIG.MONITORING_INTERVAL_MS || 3000);

  // ─── Stats printer ──────────────────────────────────────────────────────
  setInterval(() => {
    const summary = positions.getSummary();
    if (summary.totalTrades > 0 || summary.openTrades > 0) {
      console.log();
      log('info', '═══════════════ Portfolio Summary ════════════════');
      log('info', `  Open positions:   ${summary.openTrades}`);
      log('info', `  Total trades:     ${summary.totalTrades}`);
      log('info', `  Win rate:         ${summary.winRate}%  (${summary.wins}W / ${summary.losses}L)`);
      log('info', `  Total P&L:        ${summary.totalPnLSOL >= 0 ? '+' : ''}${summary.totalPnLSOL} SOL`);
      if (summary.avgWin > 0) {
        log('info', `  Avg win:          +${summary.avgWin.toFixed(4)} SOL`);
      }
      if (summary.avgLoss < 0) {
        log('info', `  Avg loss:         ${summary.avgLoss.toFixed(4)} SOL`);
      }
      log('info', '═══════════════════════════════════════════════════');
      console.log();
    }
    
    // Every 60 seconds, retry any positions that failed to close
    if (Date.now() - lastRetryTime > 60000) {
      positions.retryFailedCloses().then(retried => {
        if (retried > 0) {
          log('info', `Retried ${retried} failed position close(s)`);
        }
      }).catch(err => log('error', `Retry failed: ${err.message}`));
      lastRetryTime = Date.now();
    }
  }, 60_000); // every minute

  // ─── Check existing positions on startup ─────────────────────────────────
  const openPositions = positions.getOpenPositions();
  if (openPositions.length > 0) {
    log('info', `══════════════════════════════════════════════════`);
    log('info', `  Found ${openPositions.length} open position(s) from previous session`);
    log('info', `══════════════════════════════════════════════════`);
    
    // Show detailed position info
    for (const [mint, pos] of openPositions) {
      const timeOpen = Math.round((Date.now() - pos.openedAt) / 60000);
      const tpMultiplier = pos.sellStages ? pos.sellStages[pos.sellStages.length - 1].multiplier : 2.0;
      const tpPercent = (tpMultiplier - 1) * 100;
      const slPercent = -CONFIG.STOP_LOSS_PERCENT;
      const soldPercent = pos.totalSoldPercent || 0;
      log('info', `  📋 ${mint.slice(0, 8)}...`);
      log('info', `     Entry: ${pos.entryPrice.toExponential(3)} | TP: ${tpMultiplier}x (${tpPercent.toFixed(0)}%) | SL: ${slPercent}%`);
      log('info', `     Spent: ${pos.solSpentOriginal} SOL | Sold: ${soldPercent}% | Open: ${timeOpen}m`);
      log('info', `────────────────────────────────────────────────────────`);
    }
    
    // Use positions.checkAll which handles staged TP and SL
    await positions.checkAll(async (mint, poolId) => {
      const price = await getTokenPriceInSOL(mint, poolId);
      if (!price) {
        return await getPriceFromPool(poolId);
      }
      return price;
    });
    
    // Start monitoring mode if we still have open positions
    if (positions.count() > 0) {
      log('success', `══════════════════════════════════════════════════`);
      log('success', `  🔍 Monitoring ${positions.count()} open position(s)`);
      log('success', `══════════════════════════════════════════════════`);
    } else {
      // All positions closed, start fresh discovery
      log('info', `All previous positions closed - starting discovery`);
      await monitor.start();
      if (CONFIG.USE_SHINOBI_WS) {
        shinobiWS.connect();
      }
    }
  } else {
    // ─── Start monitor ──────────────────────────────────────────────────────
    await monitor.start();
    if (CONFIG.USE_SHINOBI_WS) {
      shinobiWS.connect();
    }

    }

  // ─── Shinobi WebSocket trade handler ─────────────────────────────────────
  if (CONFIG.USE_SHINOBI_WS) {
    shinobiWS.on('opportunity', async (opp) => {
      const { tokenAddress, price, volume, dex, volume1m } = opp;

      if (isBuying) return;
      if (positions.count() >= CONFIG.MAX_POSITIONS) {
        return;
      }

      isBuying = true;
      buyingTimeout = setTimeout(() => {
        if (isBuying) {
          log('warn', 'Buy timeout - resetting lock');
          resetBuying();
        }
      }, BUY_TIMEOUT_MS);
      log('snipe', `🚀 Shinobi opportunity: ${tokenAddress.slice(0, 8)}... ${dex} Vol: ${volume1m.toFixed(2)} SOL`);

      try {
        const balance = await getSOLBalance();
        const vaultBalance = await getVaultBalance();
        const totalBalance = balance + vaultBalance;
        const closedPnL = positions.getTotalClosedPnL();
        const buyAmount = CONFIG.USE_GRADUATED_SCALING 
          ? getDynamicBuyAmount(totalBalance, CONFIG._solPrice || 90, vaultBalance, closedPnL)
          : CONFIG.BUY_AMOUNT_SOL;
        
        if (totalBalance < buyAmount + 0.005) {
          log('warn', `Insufficient balance: ${totalBalance.toFixed(4)} SOL`);
          resetBuying();
          return;
        }

        const result = await buyToken(tokenAddress, buyAmount, null);
        if (!result.success) {
          log('error', `Buy failed: ${result.error}`);
          resetBuying();
          return;
        }

        await positions.add(tokenAddress, {
          tokenAmount: result.tokenAmount,
          pricePerToken: price || result.pricePerToken,
          solSpent: result.solSpent,
          poolId: null,
        });

        sendAlert('buy', {
          mint: tokenAddress,
          solSpent: result.solSpent,
          pricePerToken: price || result.pricePerToken,
        });
        log('success', `Position opened for ${tokenAddress.slice(0, 8)}... via ${dex}`);

        if (positions.count() >= CONFIG.MAX_POSITIONS) {
          shinobiWS.disconnect();
          monitor.isListening() && await monitor.stop();
          log('success', `══════════════════════════════════════════════════`);
          log('success', `  🎯 DISCOVERY COMPLETE — ${CONFIG.MAX_POSITIONS} positions`);
          log('success', `══════════════════════════════════════════════════`);
        }
      } catch (err) {
        log('error', `Trade error: ${err.message}`);
      } finally {
        resetBuying();
      }
    });

    shinobiWS.on('connected', () => {
      log('success', 'Shinobi WebSocket streaming active');
    });
  }

  // ─── Graceful shutdown ──────────────────────────────────────────────────
  process.on('SIGINT', async () => {
    log('warn', 'Shutting down...');
    shinobiWS.disconnect();
    await monitor.stop();
    const summary = positions.getSummary();
    log('info', `Final P&L: ${summary.totalPnLSOL} SOL`);
    process.exit(0);
  });
}

main().catch(err => {
  log('error', `Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
