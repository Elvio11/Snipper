# SniperBOT Critical Fixes + QuickNode Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical bugs (stale positions, liquidity check, SOL pair validation), implement dynamic slippage via Jupiter SDK, centralize Jupiter client, and add QuickNode-inspired features (overlap protection, balance refresh, trade logging).

**Architecture:** Centralize Jupiter SDK in `jupiter-client.js`, use `@jup-ag/api` for all Jupiter interactions, fix liquidity checks to include SOL validation, add overlap protection and structured logging.

**Tech Stack:** `@jup-ag/api` (Jupiter official SDK), Solana web3.js, JSON file for trade logging.

---

## File Structure

| File | Action | Responsibility |
|------|--------|-----------------|
| `src/jupiter-client.js` | Create | Centralized Jupiter SDK client instance |
| `positions.js` | Modify | Fix stale price (Task 1) |
| `index.js` | Modify | Fix liquidity bug (Task 2), SOL pair check (Task 3), add isSwapping flag (Task 6), balance refresh (Task 7) |
| `executor.js` | Modify | Use Jupiter SDK + dynamic slippage (Task 5) |
| `config.js` | Modify | Add new config vars (MIN_SOL_LIQUIDITY, DYNAMIC_SLIPPAGE_*) |
| `trade-logger.js` | Create | Structured JSON trade logging (Task 8) |

---

### Task 1: Fix Stale Position Price (Use Jupiter SDK)

**Files:**
- Modify: `positions.js:31-62`
- Create: `src/jupiter-client.js`

- [ ] **Step 1: Create jupiter-client.js**

```javascript
// src/jupiter-client.js
import { createJupiterApiClient } from '@jup-ag/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export const jupiterApi = createJupiterApiClient({
  basePath: 'https://quote-api.jup.ag/v6'
});

export { LAMPORTS_PER_SOL };
```

- [ ] **Step 2: Update positions.js imports**

```javascript
// Add to positions.js imports (around line 1-8)
import { jupiterApi } from './src/jupiter-client.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
```

- [ ] **Step 3: Fix clearStalePositions() to use Jupiter SDK**

```javascript
// Replace lines 31-62 in positions.js
async clearStalePositions() {
  const now = Date.now();
  const maxAge = (CONFIG.MAX_HOLD_MINUTES || 15) * 60 * 1000;

  for (const [mint, pos] of this.positions) {
    if (pos.status !== 'open') continue;

    const age = now - pos.openedAt;
    if (age < maxAge) continue;

    log('warn', `Stale position: ${mint.slice(0,8)}... (${Math.round(age/60000)}m old)`);

    try {
      const quote = await jupiterApi.quoteGet({
        inputMint: mint,
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: Math.floor(pos.tokenAmountOriginal - pos.totalSoldAmount),
        slippageBps: 1000,
      });

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
```

- [ ] **Step 4: Verify positions.js loads without errors**

Run: `node -c positions.js`
Expected: No syntax errors

- [ ] **Step 5: Commit**

```bash
git add positions.js src/jupiter-client.js
git commit -m "fix: use Jupiter SDK for stale position P&L calculation"
```

---

### Task 2: Fix Liquidity = 0 Bug + Add SOL Liquidity Check

**Files:**
- Modify: `index.js:180-188`
- Modify: `config.js:32-36`

- [ ] **Step 1: Add config variables to config.js**

```javascript
// Add after line 36 in config.js
MIN_SOL_LIQUIDITY:         parseFloat(process.env.MIN_SOL_LIQUIDITY || '0.5'), // 0.5 SOL minimum
```

- [ ] **Step 2: Fix liquidity check in index.js**

```javascript
// Replace lines 180-188 in index.js
const finalLiquidity = poolState.tvlUSD || liquidityUSD || 0;

log('info', `Pool liquidity: $${finalLiquidity.toLocaleString()} (${poolState.program})`);

// FIXED: Remove > 0 check, add SOL liquidity validation
if (finalLiquidity < CONFIG.MIN_LIQUIDITY_USD) {
  log('warn', `Liquidity too low: $${finalLiquidity}`);
  resetBuying();
  return;
}

// Check SOL liquidity via Jupiter quote
try {
  const { jupiterApi } = await import('./src/jupiter-client.js');
  const solQuote = await jupiterApi.quoteGet({
    inputMint: 'So11111111111111111111111111111111111111112',
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
  log('warn', `SOL liquidity check failed: ${err.message}`);
  resetBuying();
  return;
}
```

- [ ] **Step 3: Verify index.js loads**

Run: `node -c index.js`
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add index.js config.js
git commit -m "fix: liquidity = 0 bug + add SOL liquidity validation"
```

---

### Task 3: SOL Pair Validation (Allow if SOL Pool Exists Elsewhere)

**Files:**
- Modify: `monitor.js:454-460`

- [ ] **Step 1: Update _resolvePair in monitor.js to return null for non-SOL pairs**

```javascript
// Replace lines 454-460 in monitor.js
_resolvePair(mint0, mint1) {
  const QUOTE_MINTS = new Set([
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
  ]);
  const hasSOL = QUOTE_MINTS.has(mint0) || QUOTE_MINTS.has(mint1);
  
  if (!hasSOL) {
    log('warn', `Skipping non-SOL pair: ${mint0.slice(0,8)}/${mint1.slice(0,8)}`);
    return null; // Skip - can't sell!
  }
  
  if (QUOTE_MINTS.has(mint1) && !QUOTE_MINTS.has(mint0))
    return { tokenMint: mint0, quoteMint: mint1 };
  if (QUOTE_MINTS.has(mint0) && !QUOTE_MINTS.has(mint1))
    return { tokenMint: mint1, quoteMint: mint0 };
  return { tokenMint: mint0, quoteMint: mint1 };
}
```

- [ ] **Step 2: Verify monitor.js loads**

Run: `node -c monitor.js`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add monitor.js
git commit -m "fix: skip non-SOL pairs in monitor"
```

---

### Task 4: Install @jup-ag/api Package

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install package**

Run: `npm install @jup-ag/api`
Expected: Package added to package.json

- [ ] **Step 2: Verify installation**

Run: `npm list @jup-ag/api`
Expected: Shows version number

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @jup-ag/api official Jupiter SDK"
```

---

### Task 5: Update executor.js to Use Jupiter SDK + Dynamic Slippage

**Files:**
- Modify: `executor.js` (entire file, replace fetch calls)

- [ ] **Step 1: Update imports in executor.js**

```javascript
// Replace lines 1-10 in executor.js
import { VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getConnection, getWallet } from './wallet.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { jupiterApi } from './src/jupiter-client.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
```

- [ ] **Step 2: Rewrite getQuote function to use Jupiter SDK**

```javascript
// Replace lines 155-175 in executor.js
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
```

- [ ] **Step 3: Rewrite buyToken to use Jupiter SDK swapPost**

```javascript
// Replace lines 16-83 in executor.js
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
```

- [ ] **Step 4: Rewrite sellToken similarly (use Jupiter SDK)**

```javascript
// Replace lines 88-153 in executor.js
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
```

- [ ] **Step 5: Add dynamic slippage config to config.js**

```javascript
// Add after MIN_SOL_LIQUIDITY in config.js
DYNAMIC_SLIPPAGE:         process.env.DYNAMIC_SLIPPAGE !== 'false',
DYNAMIC_SLIPPAGE_MIN_BPS: parseInt(process.env.DYNAMIC_SLIPPAGE_MIN_BPS || '50'),
DYNAMIC_SLIPPAGE_MAX_BPS: parseInt(process.env.DYNAMIC_SLIPPAGE_MAX_BPS || '3000'),
```

- [ ] **Step 6: Verify executor.js loads**

Run: `node -c executor.js`
Expected: No syntax errors

- [ ] **Step 7: Commit**

```bash
git add executor.js config.js src/jupiter-client.js
git commit -m "feat: use Jupiter SDK + dynamic slippage in executor"
```

---

### Task 6: Add isSwapping Overlap Protection (QuickNode Feature)

**Files:**
- Modify: `index.js` (add flag around line 112)

- [ ] **Step 1: Add isSwapping flag**

```javascript
// Add after line 112 in index.js (after let isBuying = false;)
let isSwapping = false;
```

- [ ] **Step 2: Add check at start of snipe handler**

```javascript
// After line 138 (if (isBuying) block), add:
if (isSwapping) {
  log('warn', 'Transaction already in progress...');
  return;
}
```

- [ ] **Step 3: Wrap buy logic with isSwapping flag**

```javascript
// Replace lines 239-260 in index.js
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
}
```

- [ ] **Step 4: Verify index.js loads**

Run: `node -c index.js`
Expected: No syntax errors

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: add isSwapping overlap protection flag"
```

---

### Task 7: Add Balance Refresh After Swaps (QuickNode Feature)

**Files:**
- Modify: `executor.js` (after successful buy/sell)

- [ ] **Step 1: Import getBalance in executor.js**

```javascript
// Add to imports in executor.js
import { getBalance } from './wallet.js';
```

- [ ] **Step 2: Add balance refresh after successful buy**

```javascript
// After successful buy log in buyToken (after Step 3's log line)
const newBalance = await getBalance();
log('info', `Updated balance after buy: ${newBalance.toFixed(4)} SOL`);
```

- [ ] **Step 3: Add balance refresh after successful sell**

```javascript
// After successful sell log in sellToken (after Step 4's log line)
const newBalance = await getBalance();
log('info', `Updated balance after sell: ${newBalance.toFixed(4)} SOL`);
```

- [ ] **Step 4: Verify executor.js loads**

Run: `node -c executor.js`
Expected: No syntax errors

- [ ] **Step 5: Commit**

```bash
git add executor.js
git commit -m "feat: refresh balance after swaps"
```

---

### Task 8: Add Structured Trade JSON Logging (QuickNode Feature)

**Files:**
- Create: `trade-logger.js`
- Modify: `executor.js` (call logger after buy/sell)

- [ ] **Step 1: Create trade-logger.js**

```javascript
// trade-logger.js
import fs from 'fs';
import path from 'path';

const TRADE_LOG_PATH = path.join(process.cwd(), 'trade-history.jsonl');

export function logTrade(trade) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...trade,
  };

  try {
    fs.appendFileSync(TRADE_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to log trade:', err.message);
  }
}
```

- [ ] **Step 2: Import and use in executor.js**

```javascript
// Add to imports in executor.js
import { logTrade } from './trade-logger.js';
```

- [ ] **Step 3: Log trade after successful buy**

```javascript
// After successful buy in buyToken, add:
logTrade({
  type: 'buy',
  mint: mintAddress,
  solAmount: solAmount,
  tokenAmount: tokenAmount,
  pricePerToken: pricePerToken,
  txid: txid,
});
```

- [ ] **Step 4: Log trade after successful sell**

```javascript
// After successful sell in sellToken, add:
logTrade({
  type: 'sell',
  mint: mintAddress,
  solReceived: solReceived,
  tokenAmount: tokenAmount,
  txid: txid,
});
```

- [ ] **Step 5: Verify files load**

Run: `node -c trade-logger.js && node -c executor.js`
Expected: No syntax errors

- [ ] **Step 6: Commit**

```bash
git add trade-logger.js executor.js
git commit -m "feat: add structured JSON trade logging"
```

---

## Self-Review Checklist

1. **Spec coverage:** ✓ All design sections implemented (Tasks 1-8)
2. **Placeholder scan:** ✓ No TBD/TODO/empty steps
3. **Type consistency:** ✓ All function names and signatures match
4. **No placeholders:** ✓ All code blocks are complete

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-sniperbot-critical-fixes.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
