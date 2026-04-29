import { VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getConnection, getWallet, getBalance } from './wallet.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { logTrade } from './trade-logger.js';
import { jupiterApi } from './src/jupiter-client.js';
import { getTokenPriceInSOL } from './price.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP_QUOTE_API = 'https://quote-api.jup.ag/v6';

/**
 * Buy a token using Jupiter.
 * Returns { success, txid, tokenAmount, pricePerToken }
 */
export async function buyToken(mintAddress, solAmount = CONFIG.BUY_AMOUNT_SOL, poolAddress = null, retries = 2) {
  if (CONFIG.PAPER_TRADING) {
    return paperBuy(mintAddress, solAmount, poolAddress);
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      const quote = await getQuote(SOL_MINT, mintAddress, lamports);
      if (!quote) throw new Error('No quote available');

      const tokenAmount = Number(quote.outAmount);
      const pricePerToken = solAmount / (tokenAmount / 1e6);

      const wallet = getWallet();
      const swapResp = await jupiterApi.swapPost({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        dynamicSlippage: CONFIG.DYNAMIC_SLIPPAGE ? {
          minBps: CONFIG.DYNAMIC_SLIPPAGE_MIN_BPS || 50,
          maxBps: CONFIG.DYNAMIC_SLIPPAGE_MAX_BPS || 3000,
        } : undefined,
        prioritizationFeeLamports: 'auto',
      });

      if (!swapResp || !swapResp.swapTransaction) {
        throw new Error('No swap transaction returned');
      }

      const conn = getConnection();
      const txBuf = Buffer.from(swapResp.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([wallet]);

      const txid = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      await conn.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, 'confirmed');

      log('success', `BUY confirmed: ${solAmount} SOL → ${(tokenAmount/1e6).toFixed(2)} tokens`);
      logTrade({
        type: 'buy',
        mint: mintAddress,
        solAmount: solAmount,
        tokenAmount: tokenAmount,
        pricePerToken: pricePerToken,
        txid: txid,
      });
       const newBalance = await getBalance();
       log('info', `Updated balance after buy: ${newBalance.toFixed(4)} SOL`);
       return { success: true, txid, tokenAmount, pricePerToken, solSpent: solAmount };

    } catch (err) {
      lastError = err;
      log('warn', `BUY attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  log('error', `BUY failed after ${retries + 1} attempts: ${lastError?.message}`);
  return { success: false, error: lastError?.message };
}

/**
 * Sell a token back to SOL using Jupiter.
 */
export async function sellToken(mintAddress, tokenAmount, retries = 2) {
  if (CONFIG.PAPER_TRADING) {
    return paperSell(mintAddress, tokenAmount);
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const amountRaw = Math.floor(tokenAmount);

      const quote = await getQuote(mintAddress, SOL_MINT, amountRaw);
      if (!quote) throw new Error('No sell quote — possible honeypot!');

      const solReceived = Number(quote.outAmount) / LAMPORTS_PER_SOL;

      const wallet = getWallet();
      const swapResp = await jupiterApi.swapPost({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        dynamicSlippage: CONFIG.DYNAMIC_SLIPPAGE ? {
          minBps: CONFIG.DYNAMIC_SLIPPAGE_MIN_BPS || 50,
          maxBps: CONFIG.DYNAMIC_SLIPPAGE_MAX_BPS || 3000,
        } : undefined,
        prioritizationFeeLamports: 'auto',
      });

      if (!swapResp || !swapResp.swapTransaction) {
        throw new Error('No swap transaction returned');
      }

      const conn = getConnection();
      const txBuf = Buffer.from(swapResp.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([wallet]);

      const txid = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

      await conn.confirmTransaction(txid, 'confirmed');

      log('success', `SELL confirmed: ${solReceived.toFixed(4)} SOL received`);
      logTrade({
        type: 'sell',
        mint: mintAddress,
        solReceived: solReceived,
        tokenAmount: tokenAmount,
        txid: txid,
      });
       const newBalance = await getBalance();
      log('info', `Updated balance after sell: ${newBalance.toFixed(4)} SOL`);
      return { success: true, txid, solReceived };

    } catch (err) {
      lastError = err;
      log('warn', `SELL attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  log('error', `SELL failed after ${retries + 1} attempts: ${lastError?.message}`);
  return { success: false, error: lastError?.message };
}

async function getQuote(inputMint, outputMint, amount, liquidityUSD = 0) {
  const slippageBps = CONFIG.DYNAMIC_SLIPPAGE 
    ? calculateDynamicSlippage(liquidityUSD) * 100
    : CONFIG.SLIPPAGE_PERCENT * 100;

  try {
    const quote = await jupiterApi.quoteGet({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });

    if (!quote) throw new Error('No quote available');
    
    if (quote.priceImpactPct > 2) {
      throw new Error(`Price impact too high: ${quote.priceImpactPct}%`);
    }

    return quote;
  } catch (err) {
    throw new Error(`Quote failed: ${err.message}`);
  }
}

function calculateDynamicSlippage(liquidityUSD) {
  let slippage = CONFIG.SLIPPAGE_PERCENT || 10;
  
  if (liquidityUSD < 1000)        slippage = Math.max(slippage, 30);
  else if (liquidityUSD < 5000)   slippage = Math.max(slippage, 25);
  else if (liquidityUSD < 20000)  slippage = Math.max(slippage, 20);
  else if (liquidityUSD < 100000) slippage = Math.max(slippage, 15);
  else if (liquidityUSD < 1000000) slippage = Math.max(slippage, 10);
  else if (liquidityUSD < 10000000) slippage = Math.max(slippage, 5);
  else slippage = Math.max(slippage, 2);
  
  return Math.min(slippage, 50);
}

// ─── Paper trading ───────────────────────────────────────────────────────────

import { PoolService } from './src/services/pool.js';

const PAPER_PRICES = new Map(); // mintAddress → entry price in SOL

async function getEntryPrice(inputMint, outputMint, amount, poolAddress = null) {
  const lamports = Math.floor(amount * 1e9);
  
  // 1. Try Jupiter quote API
  try {
    const url = `${JUP_QUOTE_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${lamports}&slippageBps=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (!data.error && data.outAmount) {
      const tokenAmount = Number(data.outAmount);
      const pricePerToken = amount / (tokenAmount / 1e6);
      log('debug', `Entry price from Jupiter: ${pricePerToken.toExponential(3)} SOL`);
      return pricePerToken;
    }
  } catch (e) {
    log('debug', `Jupiter quote failed: ${e.message}`);
  }
  
  // 2. Try DexScreener price (via price.js getTokenPriceInSOL)
  try {
    const price = await getTokenPriceInSOL(outputMint, poolAddress);
    if (price && price > 0 && price < 100) {
      log('debug', `Entry price from DexScreener: ${price.toExponential(3)} SOL`);
      return price;
    }
  } catch (e) {
    log('debug', `DexScreener price failed: ${e.message}`);
  }
  
  // 3. No API price - use estimated fallback (for sniping very new tokens)
  const estimatedPrice = 0.000001;
  log('warn', `No API price for ${outputMint.slice(0,8)}... - using estimated ${estimatedPrice} SOL`);
  return estimatedPrice;
}

async function paperBuy(mintAddress, solAmount, poolAddress = null) {
  const pricePerToken = await getEntryPrice(SOL_MINT, mintAddress, solAmount, poolAddress);
  
  if (!pricePerToken) {
    return { success: false, error: 'No valid price - all sources failed' };
  }
  
  const tokenAmount = Math.floor((solAmount / pricePerToken) * 1e6);
  
  PAPER_PRICES.set(mintAddress, pricePerToken);
  log('trade', `[BUY] ${solAmount} SOL of ${mintAddress.slice(0,8)}... @ ${pricePerToken.toExponential(3)} SOL/token`);
  return { success: true, txid: 'buy_' + Date.now(), tokenAmount, pricePerToken, solSpent: solAmount };
}

async function paperSell(mintAddress, tokenAmount) {
  let buyPrice = PAPER_PRICES.get(mintAddress);
  
  // If no buy price in memory, try to get from position data
  if (!buyPrice) {
    buyPrice = await PoolService.getTokenPrice(mintAddress);
    if (buyPrice) buyPrice = buyPrice * 1.5; // Assume bought 50% higher
  }
  
  if (!buyPrice) {
    // Use estimated price as fallback
    buyPrice = 0.000001;
    log('warn', `No buy price for ${mintAddress.slice(0,8)}... using estimated`);
  }
  
  // Get current market price via price.js
  let currentPrice = null;
  try {
    currentPrice = await getTokenPriceInSOL(mintAddress);
  } catch (e) {
    // API failed
  }
  
  // If no current price, use estimate based on buy price
  if (!currentPrice) {
    // Assume 10% movement for estimation
    currentPrice = buyPrice * 1.10;
    log('warn', `No current price - using estimated ${currentPrice.toExponential(3)} SOL`);
  }
  
  const solReceived = (tokenAmount / 1e6) * currentPrice;
  const pnlPercent = ((solReceived - (buyPrice * tokenAmount / 1e6)) / (buyPrice * tokenAmount / 1e6)) * 100;
  const multiplier = currentPrice / buyPrice;
  
  log('trade', `[SELL] ${(tokenAmount/1e6).toFixed(2)} tokens @ ${currentPrice.toExponential(3)} SOL/token = ${solReceived.toFixed(4)} SOL (${multiplier.toFixed(2)}x, ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
  return { success: true, txid: 'sell_' + Date.now(), solReceived };
}

export function getPaperPrice(mintAddress) {
  return PAPER_PRICES.get(mintAddress);
}
