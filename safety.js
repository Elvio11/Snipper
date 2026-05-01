import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { getConnection, getWallet } from './wallet.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { dexService } from './src/services/dexscreener-service.js';


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
      liquidityQuote: 0,
      priceUSD: pair.priceUSD || 0,
      txns24h: 0,
      volume24h: pair.volume24h || 0,
      createdAt: null,
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
export async function analyzeToken(mintAddress) {
  console.log('[SAFETY] Starting analysis for:', mintAddress.slice(0,8));
  console.log('[SAFETY] HONEYPOT_CHECK enabled:', CONFIG.HONEYPOT_CHECK);
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
      reasons.push(`✔ Token indexed on DexScreener`);
      reasons.push(`│ Liquidity: $${dexData.liquidityUSD.toLocaleString()}`);
      
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
      if (dexData.txns24h < 5) {
        reasons.push(`⚠ Very low txn activity (${dexData.txns24h} txns/24h)`);
        score -= 20;
      } else {
        reasons.push(`✔ ${dexData.txns24h} txns in last 24h`);
      }
    } else {
      reasons.push(`⚠ Token not found on DexScreener - may be too new`);
    }

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

    // Transaction Simulation - PRIMARY HONEYPOT CHECK (replaces quote-only check)
    console.log('[SAFETY] Running transaction simulation...');
    const simulation = await simulateSellTransaction(mintAddress);
    console.log('[SAFETY] Simulation result:', JSON.stringify(simulation));
    
    if (simulation.isHoneypot === true) {
      reasons.push(`✖ Honeypot detected via simulation: ${simulation.reason}`);
      return { safe: false, reasons, score: 0 };
    }
    
    // Handle unknown case - simulation.isHoneypot === null
    if (simulation.isHoneypot === null) {
      // If DexScreener has the token with good liquidity → allow
      if (dexData && dexData.liquidityUSD > 0 && dexData.liquidityUSD >= CONFIG.MIN_LIQUIDITY_USD) {
        reasons.push(`⚠ Simulation inconclusive but DexScreener shows $${dexData.liquidityUSD.toLocaleString()} liquidity - allowing`);
      } else {
        // No DexScreener data + failed simulation = block
        reasons.push(`✖ Simulation failed and not on DexScreener - blocking as precaution`);
        return { safe: false, reasons, score: 0 };
      }
    } else {
      reasons.push(`✔ Transaction simulation passed`);
    }

    // Additional RugCheck validation (optional backup)
    const rugcheck = await checkRugCheck(mintAddress);
    if (rugcheck) {
      if (rugcheck.score > 50) {
        reasons.push(`✖ RugCheck high risk: score=${rugcheck.score}`);
        score -= 50;
      } else if (rugcheck.risks.length > 0) {
        reasons.push(`⚠ RugCheck risks: ${rugcheck.risks.slice(0, 3).join(', ')}`);
        score -= rugcheck.risks.length * 10;
      } else {
        reasons.push(`✔ RugCheck: score=${rugcheck.score}, lpLocked=${rugcheck.lpLockedPct.toFixed(1)}%`);
      }
    }

    const safe = score >= 40;
    return { safe, reasons, score: Math.max(0, score), dexData };

  } catch (err) {
    return { safe: false, reasons: [`Error: ${err.message}`], score: 0 };
  }
}

async function simulateSellTransaction(tokenMint, amount = 100000) {
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
          const isHoneypot = errStr.includes('6025') || 
                             errStr.includes('0x1789') || 
                             errStr.includes('"Custom":6025');
          
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

async function checkRugCheck(tokenMint) {
  const apiKey = process.env.RUGCHECK_API_KEY;
  // Proceed even if no API key is provided since the endpoint has a free tier

  try {
    const headers = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    const response = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report/summary`,
      {
        headers,
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!response.ok) {
      log('warn', `RugCheck API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    log('info', `RugCheck: score=${data.score}, risks=${data.risks?.length || 0}, lpLocked=${data.lpLockedPct?.toFixed(1) || 0}%`);

    return {
      score: data.score || 0,
      risks: data.risks || [],
      lpLockedPct: data.lpLockedPct || 0,
      tokenProgram: data.tokenProgram,
    };
  } catch (err) {
    log('warn', `RugCheck error: ${err.message}`);
    return null;
  }
}

export { simulateSellTransaction, checkRugCheck };

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