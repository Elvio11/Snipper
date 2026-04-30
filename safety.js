import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { getConnection } from './wallet.js';
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
  const reasons = [];
  let score = 100;

  try {
    // Try to get token info from DexScreener first
    const dexData = await getTokenSecurityFromDexScreener(mintAddress);
    
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

    // Try to get mint info from chain
    const conn = getConnection();
    let mintInfo = null;
    try {
      mintInfo = await getMint(conn, new PublicKey(mintAddress));
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

    // Honeypot check via Jupiter
    if (CONFIG.HONEYPOT_CHECK) {
      const honeypot = await simulateHoneypot(mintAddress);
      if (honeypot.isHoneypot) {
        reasons.push(`✖ Honeypot detected: ${honeypot.reason}`);
        return { safe: false, reasons, score: 0 };
      }
      reasons.push(`✔ Can sell on Jupiter (not honeypot)`);
    }

    const safe = score >= 40;
    return { safe, reasons, score: Math.max(0, score), dexData };

  } catch (err) {
    return { safe: false, reasons: [`Error: ${err.message}`], score: 0 };
  }
}

async function simulateHoneypot(mintAddress) {
  try {
    // ROBUST: Try BOTH buy and sell quotes to verify liquidity
    const sellUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${mintAddress}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=5000`;
    const buyUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${mintAddress}&amount=1000000&slippageBps=5000`;
    
    // Fetch both quotes in parallel
    const [sellRes, buyRes] = await Promise.all([
      fetch(sellUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(buyUrl, { signal: AbortSignal.timeout(8000) })
    ]);
    
    const sellData = await sellRes.json();
    const buyData = await buyRes.json();
    
    // If either quote fails, it's a potential honeypot
    if (sellData.error || !sellData.outAmount) {
      return { isHoneypot: true, reason: 'No sell route (cannot sell back to SOL)' };
    }
    if (buyData.error || !buyData.outAmount) {
      return { isHoneypot: true, reason: 'No buy route (cannot buy with SOL)' };
    }
    
    // Check if the quotes are reasonable (not zero or extremely low)
    const sellAmount = parseFloat(sellData.outAmount) / 1e9; // Convert to SOL
    const buyAmount = parseFloat(buyData.outAmount) / 1e6; // Convert to tokens
    
    if (sellAmount < 0.0001) {
      return { isHoneypot: true, reason: 'Suspiciously low sell output' };
    }
    if (buyAmount < 100) {
      return { isHoneypot: true, reason: 'Suspiciously low buy output' };
    }
    
    return { isHoneypot: false };
  } catch (err) {
    // If we can't get quotes, treat as potential honeypot (conservative)
    return { isHoneypot: true, reason: `Cannot get quotes: ${err.message}` };
  }
}

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