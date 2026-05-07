import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { getConnection, getWallet } from './wallet.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { dexService } from './src/services/dexscreener-service.js';
import { rugCheck } from './rugcheck.js';


const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Get recent tokens from DexScreener that have been indexed.
 * These tokens have metadata available (name, symbol, liquidity) - safer to snipe.
 * Returns tokens created in the last few hours that still have low volume.
 */
export async function getRecentIndexedTokens(limit = 20) {
  try {
    const result = await dexService.getRecentTokens(limit);
    if (result.success && result.data) {
      return result.data;
    }
    return [];
  } catch (err) {
    log('warn', `Failed to fetch recent tokens: ${err.message}`);
    return [];
  }
}

/**
 * Get token security data from DexScreener.
 */
export async function getTokenSecurityFromDexScreener(tokenMint) {
  try {
    const result = await dexService.getTokenSecurity(tokenMint);
    if (!result.success || !result.data) return null;
    
    const pair = result.data;
    return {
      liquidityUSD: pair.liquidityUSD || 0,
      liquidityQuote: pair.liquidityQuote || 0,
      quoteTokenSymbol: pair.quoteTokenSymbol || '',
      quoteTokenAddress: pair.quoteTokenAddress || '',
      priceUSD: pair.priceUSD || 0,
      priceSOL: pair.priceNative || 0, // DexScreener returns price in native quote asset (SOL) as priceNative
      txns24h: 0,
      volume24h: pair.volume24h || 0,
      pairCreatedAt: pair.pairCreatedAt || 0,
      pairAddress: pair.pairAddress,
      tokenAddress: tokenMint,
    };
  } catch {
    return null;
  }
}

/**
 * Simplified safety analysis - focuses on available data from DexScreener
 * instead of trying to analyze extremely new tokens.
 */
export async function analyzeToken(mintAddress, poolInfo = null) {
  console.log('[SAFETY] Starting analysis for:', mintAddress);
  const minSolLiq = CONFIG.MIN_SOL_LIQUIDITY || 3.5;
  let solPrice = CONFIG._solPrice || 145; 
  const reasons = [];
  let score = 100;

  const withTimeout = (promise, ms, name) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timeout`)), ms))
    ]);
  };

  try {
    // Try to get token info from DexScreener first (with timeout)
    const dexData = await withTimeout(getTokenSecurityFromDexScreener(mintAddress), 8000, 'DexScreener');
    
    if (dexData && dexData.liquidityUSD > 0) {
      // dexData.priceUSD is the token price in USD
      // dexData.priceSOL is the token price in SOL (priceNative)
      // If we have both, we can derive a highly accurate SOL price: SOL = USD / priceSOL
      if (dexData.priceUSD > 0 && dexData.priceSOL > 0) {
        const derivedSolPrice = parseFloat(dexData.priceUSD) / parseFloat(dexData.priceSOL);
        if (derivedSolPrice > 50 && derivedSolPrice < 500) { // Sanity check
          solPrice = derivedSolPrice;
          CONFIG._solPrice = solPrice; // Update global config
        }
      }
      
      log('info', `[SAFETY] Threshold: ${minSolLiq} SOL (~$${(minSolLiq * solPrice).toFixed(0)}) | SOL Price: $${solPrice.toFixed(2)}`);
      reasons.push(`✔ Token indexed on DexScreener`);
      reasons.push(`│ Liquidity: $${dexData.liquidityUSD.toLocaleString()}`);
      
      const tokenAgeMs = dexData.pairCreatedAt ? (Date.now() - dexData.pairCreatedAt) : 0;
      const isEstablished = tokenAgeMs > (CONFIG.ESTABLISHED_TOKEN_AGE_MS || 3600000); // Default 1 hour
      
      if (isEstablished) {
        reasons.push(`│ Age: ${(tokenAgeMs / 3600000).toFixed(1)} hours (Established)`);
      } else if (tokenAgeMs > 0) {
        reasons.push(`│ Age: ${(tokenAgeMs / 60000).toFixed(1)} minutes`);
      }
      
      // Check liquidity is within range
      if (dexData.liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) {
        reasons.push(`✖ Liquidity too low: $${dexData.liquidityUSD.toLocaleString()}`);
        return { safe: false, reasons, score: 0 };
      }
      
      if (dexData.liquidityUSD > CONFIG.MAX_LIQUIDITY_USD) {
        reasons.push(`✖ Liquidity too high (probably already pumped)`);
        return { safe: false, reasons, score: 0 };
      }
      
      // Check for some transaction activity (not dead token)
      const isMigration = poolInfo?.source === 'migration_onlogs' || poolInfo?.source === 'pumpportal';
      if (dexData.txns24h < 5 && !isMigration) {
        reasons.push(`⚠ Very low txn activity (${dexData.txns24h} txns/24h)`);
        score -= 20;
      } else if (isMigration) {
        reasons.push(`✔ Migration grace period: bypassing activity check`);
      } else {
        reasons.push(`✔ ${dexData.txns24h} txns in last 24h`);
      }
    } else {
      reasons.push(`⚠ Token not found on DexScreener - may be too new`);
      log('info', `[SAFETY] Threshold: ${minSolLiq} SOL (~$${(minSolLiq * solPrice).toFixed(0)}) | SOL Price: $${solPrice.toFixed(2)} (est)`);
    }

    // ENFORCE 3.5 SOL LIQUIDITY THRESHOLD
    // Case 1: PoolInfo from monitor (has liquidityUSD or pumpData)
    let currentLiqUSD = dexData?.liquidityUSD || poolInfo?.liquidityUSD || 0;
    
    // Case 2: If PumpFun migration, use virtual reserves if available
    if (poolInfo?.pumpData?.virtualSolReserves) {
      const solReserves = parseFloat(poolInfo.pumpData.virtualSolReserves) / 1e9;
      reasons.push(`[PUMP] Virtual SOL reserves: ${solReserves.toFixed(2)} SOL`);
      if (solReserves > 0) currentLiqUSD = solReserves * solPrice;
    }

    let currentLiqSOL = 0;
    if (dexData?.quoteTokenAddress === SOL_MINT && dexData.liquidityQuote > 0) {
      currentLiqSOL = dexData.liquidityQuote;
      reasons.push(`│ Direct SOL Liquidity: ${currentLiqSOL.toFixed(2)} SOL (from DexScreener)`);
    } else {
      currentLiqSOL = currentLiqUSD / solPrice;
      reasons.push(`│ Derived SOL Liquidity: ${currentLiqSOL.toFixed(2)} SOL ($${currentLiqUSD.toFixed(0)} / $${solPrice.toFixed(0)})`);
    }

    if (currentLiqSOL < minSolLiq) {
      reasons.push(`✖ Liquidity too low: ${currentLiqSOL.toFixed(2)} SOL < ${minSolLiq} SOL threshold`);
      return { safe: false, reasons, score: 0 };
    }
    reasons.push(`✔ Liquidity passed: ${currentLiqSOL.toFixed(2)} SOL (threshold: ${minSolLiq})`);

    // Try to get mint info from chain (with timeout)
    const conn = getConnection();
    let mintInfo = null;
    try {
      mintInfo = await withTimeout(getMint(conn, new PublicKey(mintAddress)), 5000, 'RPC');
      reasons.push(`✔ Mint info available on-chain`);
      
      // Check mint authority
      if (mintInfo.mintAuthority !== null) {
        reasons.push(`⚠ Mint authority NOT revoked - can print tokens`);
        score -= 30;
      } else {
        reasons.push(`✔ Mint authority revoked`);
      }
      
      // Check freeze authority
      if (mintInfo.freezeAuthority !== null) {
        reasons.push(`⚠ Freeze authority NOT revoked`);
        score -= 20;
      } else {
        reasons.push(`✔ Freeze authority revoked`);
      }
      
      // Supply check
      const supply = Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals);
      if (supply > 10_000_000_000) {
        reasons.push(`✖ Supply too high: ${supply.toExponential(2)}`);
        return { safe: false, reasons, score: 0 };
      }
      reasons.push(`│ Supply: ${supply.toExponential(2)}`);
      
    } catch (mintErr) {
      reasons.push(`⚠ Cannot fetch mint info: ${mintErr.message?.slice(0, 50)}`);
      score -= 10;
    }

    // Transaction Simulation - HONEYPOT CHECK (Optional)
    if (CONFIG.HONEYPOT_SIMULATION_ENABLED) {
      console.log('[SAFETY] Running transaction simulation...');
      const simulation = await simulateSellTransaction(mintAddress, 1000000, dexData);
      console.log('[SAFETY] Simulation result:', JSON.stringify(simulation));
      
      if (simulation.isHoneypot === true) {
        reasons.push(`✖ Honeypot detected via simulation: ${simulation.reason}`);
        return { safe: false, reasons, score: 0 };
      }
      
      if (simulation.isHoneypot === null) {
        if (dexData && dexData.liquidityUSD > 0 && dexData.liquidityUSD >= CONFIG.MIN_LIQUIDITY_USD) {
          reasons.push(`⚠ Simulation inconclusive but DexScreener shows $${dexData.liquidityUSD.toLocaleString()} liquidity - allowing`);
        } else {
          reasons.push(`✖ Simulation failed: ${simulation.reason || 'unknown'} - blocking to save fees`);
          return { safe: false, reasons, score: 0 };
        }
      } else {
        reasons.push(`✔ Transaction simulation passed`);
      }
    } else {
      reasons.push(`ℹ Honeypot simulation disabled (relying on RugCheck)`);
    }

    // Tiered RugCheck validation using consolidated module
    const rugReport = await rugCheck(mintAddress);
    if (rugReport && rugReport.score !== null) {
      const rugcheck = {
        score: rugReport.score,
        risks: rugReport.risks,
        lpLockedPct: rugReport.lpLockedPct || 0
      };
      // TIERED THRESHOLD: Standard (e.g. 600), High-Liq Migration (>10 SOL) (e.g. 650)
      let rugThreshold = CONFIG.RUGCHECK_TIER_STANDARD || 600;
      if (currentLiqSOL > 10) {
        rugThreshold = CONFIG.RUGCHECK_TIER_HIGH_LIQ || 650;
        reasons.push(`[TIER] High-liquidity mode active (Threshold: ${rugThreshold})`);
      } else {
        reasons.push(`[TIER] Standard mode active (Threshold: ${rugThreshold})`);
      }

      const tokenAgeMs = dexData?.pairCreatedAt ? (Date.now() - dexData.pairCreatedAt) : 0;
      const isEstablished = tokenAgeMs > (CONFIG.ESTABLISHED_TOKEN_AGE_MS || 3600000);

      if (rugcheck.score > rugThreshold) {
        // If established with high liquidity, don't penalize as harshly
        if (isEstablished && (dexData?.liquidityUSD || 0) > 20000) {
          reasons.push(`⚠ RugCheck high risk (${rugcheck.score}) but token is established - reduced penalty`);
          score -= 20;
        } else {
          reasons.push(`✖ RugCheck high risk: score=${rugcheck.score} (threshold: ${rugThreshold})`);
          score -= 50;
        }
      } else if (rugcheck.risks.length > 0) {
        const riskPenalty = isEstablished ? 5 : 10;
        reasons.push(`⚠ RugCheck risks: ${rugcheck.risks.slice(0, 3).map(r => r.name || r).join(', ')}`);
        score -= rugcheck.risks.length * riskPenalty;
      } else {
        reasons.push(`✔ RugCheck: score=${rugcheck.score}, lpLocked=${rugcheck.lpLockedPct.toFixed(1)}%`);
      }
    }

    const safe = score >= (CONFIG.MIN_SAFETY_SCORE || 40);
    return { safe, reasons, score: Math.max(0, score), dexData };

  } catch (err) {
    return { safe: false, reasons: [`Error: ${err.message}`], score: 0 };
  }
}

async function simulateSellTransaction(tokenMint, amount = 1000000, dexData = null) {
  const conn = getConnection();
  const wallet = getWallet();
  const amountsToTry = [1000000]; // Single attempt with 1M lamports

  let lastFailureReason = null;
  let triedRPCSwitch = false;

  for (const tryAmount of amountsToTry) {
    for (let rpcAttempt = 0; rpcAttempt < 2; rpcAttempt++) {
      try {
        const currentConn = getConnection();
        log('info', `Simulation (${tryAmount} lamports, RPC attempt ${rpcAttempt + 1}): Testing token→SOL for ${tokenMint.slice(0,8)}...`);

        const params = new URLSearchParams({
          inputMint: tokenMint,
          outputMint: SOL_MINT,
          amount: tryAmount.toString(),
          slippageBps: '5000',
          taker: wallet.publicKey.toString(),
        });

        const headers = { 'Accept': 'application/json' };
        if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

        const res = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
          lastFailureReason = `No quote for amount ${tryAmount} (HTTP ${res.status})`;
          log('warn', lastFailureReason);
          break;
        }

        const swapResp = await res.json();

        if (!swapResp || !swapResp.transaction) {
          lastFailureReason = `No swap tx for amount ${tryAmount}`;
          log('warn', lastFailureReason);
          break;
        }

        // Prepare transaction for simulation
        const txBuf = Buffer.from(swapResp.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(txBuf);

        // Get fresh blockhash
        const { blockhash } = await currentConn.getLatestBlockhash();
        transaction.message.recentBlockhash = blockhash;

        // SIMULATE (free - not broadcast, no signature needed)
        const simResult = await currentConn.simulateTransaction(transaction, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });

        // Check simulation result
        if (simResult.value.err) {
          const errStr = JSON.stringify(simResult.value.err);
          
          // 6025 (decimal) and 0x1789 (hex) both = honeypot - cannot sell
          const is6025 = errStr.includes('6025') || errStr.includes('"Custom":6025');
          const isHoneypot = is6025 || errStr.includes('0x1789');

          // AGE OVERRIDE: If token is > 1 hour old, ignore 6025 (Bonding Curve Complete)
          const tokenAgeMs = dexData?.pairCreatedAt ? (Date.now() - dexData.pairCreatedAt) : 0;
          const isEstablished = tokenAgeMs > 3600000; // 1 hour

          if (isEstablished && is6025) {
            log('info', `[SAFETY] Detected 6025 on established token (${(tokenAgeMs / 3600000).toFixed(1)}h old) - bypass simulation block`);
            return { isHoneypot: false, reason: 'Age override: 6025 on established token' };
          }
          
          if (isHoneypot) {
            log('warn', `Honeypot CONFIRMED via simulation: ${errStr}`);
            return { isHoneypot: true, reason: `Honeypot: contract blocks transfer (6025/0x1789)` };
          }
          
          // Non-honeypot sim error — might be RPC issue, try switching RPC once
          lastFailureReason = `Simulation error (non-honeypot): ${errStr}`;
          if (!triedRPCSwitch && rpcAttempt === 0) {
            log('info', `Simulation non-honeypot error: ${errStr} — retrying with different RPC`);
            const { switchRPC } = await import('./wallet.js');
            switchRPC();
            triedRPCSwitch = true;
            continue; // Retry with new RPC
          }
          
          // Non-honeypot error on second attempt — still ALLOW the token
          log('info', `Simulation non-honeypot error on retry: ${errStr} — allowing token`);
          return { isHoneypot: false, reason: `Non-honeypot sim error: ${errStr}` };
        }

        // Simulation passed — token is tradeable, ALWAYS allow
        log('info', `Simulation passed with amount ${tryAmount} — token is tradeable`);
        return { isHoneypot: false };

      } catch (err) {
        lastFailureReason = `Simulation exception: ${err.message}`;
        
        // If it's an RPC error (not a contract error), try switching RPC
        if (!triedRPCSwitch && rpcAttempt === 0) {
          log('warn', `Simulation failed (${err.message}) — retrying with different RPC`);
          const { switchRPC } = await import('./wallet.js');
          switchRPC();
          triedRPCSwitch = true;
          continue;
        }
        
        log('warn', `Simulation attempt ${tryAmount} failed on retry: ${err.message}`);
        break;
      }
    }
  }

  // All simulation attempts failed — fall back to quote-only check
  log('warn', `All simulation attempts failed (reason: ${lastFailureReason}) — falling back to quote check`);
  try {
    const params = new URLSearchParams({
      inputMint: tokenMint,
      outputMint: SOL_MINT,
      amount: '1000000',
      slippageBps: '5000'
    });

    const headers = { 'Accept': 'application/json' };
    if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

    const res = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const quote = await res.json();
      if (quote?.outAmount) {
        log('info', `Fallback: quote available — allowing token`);
        return { isHoneypot: false, reason: 'Fallback: quote available' };
      }
    }
  } catch (e) {
    log('warn', `Fallback quote check also failed: ${e.message}`);
  }

  // If everything fails, return as unknown
  // Handle this in analyzeToken based on DexScreener data availability
  return { isHoneypot: null, reason: `All checks failed: ${lastFailureReason}` };
}

export { simulateSellTransaction };

export async function getLPBurnPercent(poolId) {
  try {
    const res = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolId}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    const pool = data?.data?.[0];
    return pool?.burnPercent || 0;
  } catch {
    return 0;
  }
}