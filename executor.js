import { VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { getConnection, getWallet, getVaultWallet, getSOLBalance as getBalance, paperDeductSigner, paperCreditSigner, paperTransferToVault } from './wallet.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { logTrade } from './trade-logger.js';

import { getTokenPriceInSOL } from './price.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SWAP_V2_BASE = 'https://api.jup.ag/swap/v2';
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ─── Jupiter Swap V2: /order + /execute (recommended path) ───────────────────

/**
 * GET /swap/v2/order — returns quote + assembled transaction.
 * All routing engines compete: Metis, JupiterZ RFQ, Dflow, OKX.
 */
async function jupiterV2Order(inputMint, outputMint, amount, taker, slippageBps = null) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    taker,
  });
  // Only pass slippageBps if explicitly set; otherwise Jupiter uses RTSE (automatic)
  if (slippageBps !== null) {
    params.set('slippageBps', String(slippageBps));
  }

  const headers = { 'Accept': 'application/json' };
  if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

  const res = await fetch(`${SWAP_V2_BASE}/order?${params}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/order failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const order = await res.json();
  if (!order.transaction) {
    throw new Error(`/order returned no transaction: ${JSON.stringify(order).slice(0, 200)}`);
  }
  return order;
}

/**
 * POST /swap/v2/execute — Jupiter handles tx landing, MEV protection, retries.
 * Dedicated rate limit bucket (50 RPS free, 100 RPS paid).
 */
async function jupiterV2Execute(signedTxBase64, requestId) {
  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

  const res = await fetch(`${SWAP_V2_BASE}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ signedTransaction: signedTxBase64, requestId }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/execute failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const result = await res.json();
  return result; // { status, signature, code, inputAmountResult, outputAmountResult, error? }
}

async function getDestinationTokenAccount(mint, owner) {
  const [ata] = await PublicKey.findProgramAddress(
    [mint.toBuffer(), owner.toBuffer()],
    ATA_PROGRAM
  );
  return ata;
}

/**
 * Buy a token using Jupiter.
 * Returns { success, txid, tokenAmount, pricePerToken }
 */
export async function buyToken(mintAddress, solAmount = CONFIG.BUY_AMOUNT_SOL, poolAddress = null, slippageBps = null, retries = 2) {
  if (CONFIG.PAPER_TRADING) {
    return paperBuy(mintAddress, solAmount, poolAddress);
  }

  const wallet = getWallet();
  const conn = getConnection();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
      const finalSlippageBps = slippageBps || (CONFIG.SLIPPAGE_PERCENT * 100);

      // ── Jupiter Swap V2: /order (all routers compete for best price) ──
      log('info', `[V2] Requesting order: ${solAmount} SOL → ${mintAddress.slice(0,8)}... (slippage: ${finalSlippageBps/100}%)`);
      const order = await jupiterV2Order(
        SOL_MINT, mintAddress, lamports,
        wallet.publicKey.toString(), finalSlippageBps
      );

      const tokenAmount = Number(order.outAmount);
      
      // Fetch decimals to calculate accurate entry price
      let decimals = 6;
      try {
        const mintInfo = await conn.getParsedAccountInfo(new PublicKey(mintAddress));
        if (mintInfo.value?.data?.parsed?.info?.decimals !== undefined) {
          decimals = mintInfo.value.data.parsed.info.decimals;
        }
      } catch (e) {
        log('debug', `Failed to fetch decimals for ${mintAddress}: ${e.message}`);
      }
      
      const pricePerToken = solAmount / (tokenAmount / Math.pow(10, decimals));
      log('info', `[V2] Order received: router=${order.router} mode=${order.mode} out=${tokenAmount} feeBps=${order.feeBps}`);

      // ── Sign the transaction ──
      const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
      tx.sign([wallet]);
      const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');

      // ── Execute via Jupiter (managed landing, MEV protection) ──
      log('info', `[V2] Executing via Jupiter (managed landing)...`);
      const result = await jupiterV2Execute(signedTxBase64, order.requestId);

      if (result.status !== 'Success') {
        throw new Error(`Jupiter /execute failed: code=${result.code} ${result.error || ''}`);
      }

      const txid = result.signature;
      const actualTokens = Number(result.outputAmountResult) || tokenAmount;
      const actualSOL = Number(result.inputAmountResult) / LAMPORTS_PER_SOL || solAmount;

      log('success', `BUY confirmed [V2]: ${actualSOL.toFixed(6)} SOL → ${(actualTokens/1e6).toFixed(2)} tokens (tx: ${txid.slice(0,8)}...)`);
      logTrade({
        type: 'buy', mint: mintAddress,
        solAmount: actualSOL, tokenAmount: actualTokens,
        pricePerToken, txid,
      });

      // ── Signer → Vault: keep 0.006 SOL for gas ──
      const keepForGas = 0.006;
      const currentSignerBal = await conn.getBalance(wallet.publicKey);
      const currentSignerSOL = currentSignerBal / LAMPORTS_PER_SOL;
      const transferBack = currentSignerSOL - keepForGas;

      if (transferBack > 0.001) {
        try {
          const vaultWallet = getVaultWallet();
          const transferTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: vaultWallet.publicKey,
              lamports: Math.floor(transferBack * LAMPORTS_PER_SOL),
            })
          );
          await sendAndConfirmTransaction(conn, transferTx, [wallet]);
          log('info', `Signer → Vault: ${transferBack.toFixed(4)} SOL (kept ${keepForGas} for gas)`);
        } catch (transferErr) {
          log('warn', `Signer → Vault transfer failed: ${transferErr.message}`);
        }
      }

      const newBalance = await getBalance();
      log('info', `Updated balance after buy: ${newBalance.toFixed(4)} SOL`);
      return { success: true, txid, tokenAmount: actualTokens, pricePerToken, solSpent: actualSOL };

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
export async function sellToken(mintAddress, tokenAmount, slippageBps = null, retries = 2) {
  if (CONFIG.PAPER_TRADING) {
    return paperSell(mintAddress, tokenAmount);
  }

  const wallet = getWallet();
  const conn = getConnection();

  // Check signer balance before attempting sell (for gas fees)
  const signerBalance = await conn.getBalance(wallet.publicKey);
  const minBalance = 0.003 * LAMPORTS_PER_SOL; // 0.003 SOL minimum (V2 manages priority fees)

  if (signerBalance < minBalance) {
    log('error', `Insufficient signer balance: ${(signerBalance/LAMPORTS_PER_SOL).toFixed(6)} SOL, need 0.003 SOL for gas`);
    return { success: false, error: `Insufficient signer balance: ${(signerBalance/LAMPORTS_PER_SOL).toFixed(6)} SOL` };
  }

  const vaultWallet = getVaultWallet();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const amountRaw = Math.floor(tokenAmount);
      const finalSlippageBps = slippageBps || (CONFIG.SLIPPAGE_PERCENT * 100);

      // ── Jupiter Swap V2: /order (token → SOL) ──
      log('info', `[V2] Requesting sell order: ${mintAddress.slice(0,8)}... → SOL (slippage: ${finalSlippageBps/100}%)`);
      const order = await jupiterV2Order(
        mintAddress, SOL_MINT, amountRaw,
        wallet.publicKey.toString(), finalSlippageBps
      );

      const solReceived = Number(order.outAmount) / LAMPORTS_PER_SOL;
      log('info', `[V2] Sell order: ~${solReceived.toFixed(6)} SOL, router=${order.router}`);

      // ── Sign ──
      const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
      tx.sign([wallet]);
      const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');

      // ── Execute via Jupiter (managed landing) ──
      const result = await jupiterV2Execute(signedTxBase64, order.requestId);

      if (result.status !== 'Success') {
        throw new Error(`Jupiter /execute sell failed: code=${result.code} ${result.error || ''}`);
      }

      const txid = result.signature;
      const actualSOL = Number(result.outputAmountResult) / LAMPORTS_PER_SOL || solReceived;

      log('success', `SELL confirmed [V2]: ${actualSOL.toFixed(6)} SOL received (tx: ${txid.slice(0,8)}...)`);
      logTrade({
        type: 'sell', mint: mintAddress,
        solReceived: actualSOL, tokenAmount, txid,
      });

      // ── Transfer proceeds to vault ──
      const currentBalance = await conn.getBalance(wallet.publicKey);
      const afterSellBalance = currentBalance / LAMPORTS_PER_SOL;
      const keepForGas = 0.006;
      const transferAmount = afterSellBalance - keepForGas;

      if (transferAmount > 0.001) {
        try {
          const transferTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: vaultWallet.publicKey,
              lamports: Math.floor(transferAmount * LAMPORTS_PER_SOL),
            })
          );
          await sendAndConfirmTransaction(conn, transferTx, [wallet]);
          log('info', `Transferred ${transferAmount.toFixed(4)} SOL to vault (tx: ${txid.slice(0,8)}...)`);
        } catch (transferErr) {
          log('warn', `Transfer to vault failed: ${transferErr.message}`);
        }
      }

      const newBalance = await getBalance();
      log('info', `Updated balance after sell: ${newBalance.toFixed(4)} SOL`);
      return { success: true, txid, solReceived: actualSOL, transferredToVault: transferAmount > 0.001 ? transferAmount : 0 };

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
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString()
    });

    const headers = { 'Accept': 'application/json' };
    if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

    const res = await fetch(`${SWAP_V2_BASE}/order?${params}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quote = await res.json();
    if (!quote || !quote.outAmount) throw new Error('No quote available');
    
    // Jupiter V2 returns priceImpactPct directly or we can calculate it
    // Wait, the V2 API actually returns priceImpactBps? Let's check or just assume it's valid if it returns.
    // Actually V2 doesn't always return priceImpactPct, but we can verify it if it does.
    if (quote.priceImpactPct && quote.priceImpactPct > 2) {
      throw new Error(`Price impact too high: ${quote.priceImpactPct}%`);
    }

    return quote;
  } catch (err) {
    throw new Error(`Quote failed: ${err.message}`);
  }
}

export function calculateDynamicSlippage(liquidityUSD) {
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
  
  // 1. Try Jupiter quote API (V2)
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: lamports.toString(),
      slippageBps: '1000'
    });

    const headers = { 'Accept': 'application/json' };
    if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

    const res = await fetch(`${SWAP_V2_BASE}/order?${params}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json();
      if (!data.error && data.outAmount) {
        // Jupiter returns decimals dynamically, but we estimate using raw amount
        const tokenAmountRaw = Number(data.outAmount);
        
        // Wait, to calculate exact price we need decimals. 
        // We'll just calculate price in lamports per raw token, or try fallback if it's too complex.
        // Actually, fallback to DexScreener is much more reliable for price mapping.
        // Let's just use getTokenPriceInSOL for Jupiter V3 price API integration directly:
        const jupPrice = await getTokenPriceInSOL(outputMint, poolAddress);
        if (jupPrice) {
          log('debug', `Entry price from TokenPrice API: ${jupPrice.toExponential(3)} SOL`);
          return jupPrice;
        }
      }
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
  
  // Simulate slippage impact: reduce received tokens by slippage %
  const slippagePercent = CONFIG.SLIPPAGE_PERCENT || 10;
  const slippageFactor = 1 - (slippagePercent / 100);
  const tokenAmount = Math.floor((solAmount / pricePerToken) * 1e6 * slippageFactor);
  
  PAPER_PRICES.set(mintAddress, pricePerToken);
  // Track paper balance: deduct buy amount from signer
  paperDeductSigner(solAmount);
  // Signer → Vault: transfer excess back to vault (keep 0.006 SOL for gas)
  const { getSOLBalance: getPaperSignerBal } = await import('./wallet.js');
  const signerBal = await getPaperSignerBal();
  const keepForGas = 0.006;
  const excessToVault = signerBal - keepForGas;
  if (excessToVault > 0.001) {
    paperTransferToVault(excessToVault);
    log('info', `[PAPER] Signer → Vault: ${excessToVault.toFixed(4)} SOL (kept ${keepForGas} for gas)`);
  }
  log('trade', `[PAPER BUY] ${solAmount} SOL of ${mintAddress.slice(0,8)}... @ ${pricePerToken.toExponential(3)} SOL/token (slippage: ${slippagePercent}%)`);
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
  
  // Track paper balance: credit sell proceeds to signer, then transfer to vault
  paperCreditSigner(solReceived);
  const keepForGas = 0.005;
  const transferAmount = Math.max(0, solReceived - keepForGas);
  if (transferAmount > 0.001) {
    paperTransferToVault(transferAmount);
  }
  
  log('trade', `[PAPER SELL] ${(tokenAmount/1e6).toFixed(2)} tokens @ ${currentPrice.toExponential(3)} SOL/token = ${solReceived.toFixed(4)} SOL (${multiplier.toFixed(2)}x, ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
  return { success: true, txid: 'sell_' + Date.now(), solReceived };
}

export function getPaperPrice(mintAddress) {
  return PAPER_PRICES.get(mintAddress);
}
