# On-Chain Sell Verification Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure positions are only marked as closed after sell transactions are confirmed on-chain, not just after the API call returns.

**Architecture:** Add verification steps in positions.js close methods to check sell success and verify on-chain balance changes. If sell fails, keep position open and log warning.

**Tech Stack:** Solana Web3.js, Jupiter API, positions.js, executor.js

---

## Root Cause Analysis

In `positions.js` lines 241-252, when closing a position:
```javascript
if (remainingTokens > 0) {
  const result = await sellToken(mintAddress, remainingTokens);
  const solReceived = result.solReceived || 0;  // BUG: doesn't check result.success!
  // ...calculates PnL...
}
pos.status = 'closed';  // BUG: runs even if sell failed!
```

The `sellToken` function correctly returns `{ success: false, error: ... }` on failure, but positions.js ignores this and marks the position as closed anyway.

---

## File Structure

- Modify: `positions.js` - Add sell verification before marking closed
- Modify: `executor.js` - Ensure error details are clear
- Modify: `index.js` - Add transaction confirmation logging

---

## Task 1: Fix positions.js - Verify Sell Success

**Files:**
- Modify: `positions.js:241-252` (closePosition method)
- Modify: `positions.js:256-263` (_closeFully method)

- [ ] **Step 1: Read the closePosition method in positions.js**

```javascript
// Current problematic code around line 241-252:
if (remainingTokens > 0) {
  const result = await sellToken(mintAddress, remainingTokens);
  const solReceived = result.solReceived || 0;
  const profitFromRemaining = solReceived - remainingCost;
  pos.pnlSOL = (pos.pnlSOL || 0) + profitFromRemaining;
}
pos.status = 'closed';
pos.closeReason = reason;
```

- [ ] **Step 2: Fix closePosition to verify sell success**

Replace the problematic section with:
```javascript
if (remainingTokens > 0) {
  const result = await sellToken(mintAddress, remainingTokens);
  
  // VERIFY SELL SUCCESS BEFORE MARKING CLOSED
  if (!result.success) {
    log('error', `Sell failed for ${mintAddress.slice(0,8)}... - keeping position open. Error: ${result.error}`);
    // Don't close position - try again later or let monitoring handle it
    return; // Exit early - position stays open
  }
  
  const solReceived = result.solReceived || 0;
  const profitFromRemaining = solReceived - remainingCost;
  pos.pnlSOL = (pos.pnlSOL || 0) + profitFromRemaining;
}
pos.status = 'closed';
pos.closeReason = reason;
```

- [ ] **Step 3: Fix _closeFully method - add verification**

Read _closeFully (around line 256-263):
```javascript
async _closeFully(mintAddress, pos, reason) {
  pos.status = 'closed';
  pos.closeReason = reason;
  pos.closedAt = Date.now();
  pos.pnlPercent = ((pos.pnlSOL || 0) / pos.solSpentOriginal) * 100;
  this._save();
  this._logTrade(pos);
}
```

Replace with verification:
```javascript
async _closeFully(mintAddress, pos, reason) {
  // Only close if there's no token amount remaining or sell succeeded
  // If sell fails, keep position open and let monitoring retry
  
  if (pos.tokenAmount > 0 && !CONFIG.PAPER_TRADING) {
    // Try to sell remaining tokens first
    const result = await sellToken(mintAddress, pos.tokenAmount);
    
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
  this._logTrade(pos);
}
```

- [ ] **Step 4: Run tests to verify no breaking changes**

```bash
npm test
```
Expected: All tests pass (may have pre-existing failures)

- [ ] **Step 5: Commit**

```bash
git add positions.js
git commit -m "fix: verify sell success before marking position closed"
```

---

## Task 2: Add On-Chain Balance Verification

**Files:**
- Modify: `executor.js:123-135` - Add confirmation verification
- Add: Helper function to verify token balance change

- [ ] **Step 1: Enhance sellToken confirmation**

Read executor.js around line 118-135:
```javascript
const txid = await conn.sendRawTransaction(tx.serialize(), {
  skipPreflight: true,
  maxRetries: 3,
});

await conn.confirmTransaction(txid, 'confirmed');
```

Replace with verification:
```javascript
const txid = await conn.sendRawTransaction(tx.serialize(), {
  skipPreflight: true,
  maxRetries: 3,
});

// Verify transaction actually succeeded on-chain
const confirmation = await conn.confirmTransaction(txid, 'confirmed');

if (confirmation.value?.err) {
  throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
}

// Double-check: verify token balance decreased
const tokenAccount = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, {
  mint: new PublicKey(mintAddress)
});
const tokenBalance = tokenAccount.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;

if (tokenBalance > 0) {
  log('warn', `Sell confirmed but still hold ${tokenBalance} tokens - may need manual intervention`);
}

log('success', `SELL confirmed: ${solReceived.toFixed(4)} SOL received`);
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add executor.js
git commit -m "fix: add on-chain verification after sell transaction"
```

---

## Task 3: Add Monitoring Retry for Failed Sells

**Files:**
- Modify: `positions.js` - Add method to retry failed closes
- Modify: `index.js` - Call retry on monitoring loop

- [ ] **Step 1: Add retry logic to positions.js**

Add new method after _closeFully:
```javascript
async retryFailedCloses() {
  const openPositions = this.getOpenPositions();
  let retried = 0;
  
  for (const [mint, pos] of openPositions) {
    if (pos.closeReason === 'sell_failed' || !pos.closeReason) {
      // Try to close again
      log('info', `Retrying close for ${mint.slice(0,8)}...`);
      await this.closePosition(mint, 'manual_close');
      retried++;
    }
  }
  
  return retried;
}
```

- [ ] **Step 2: Add retry call in index.js monitoring**

Find monitoring loop in index.js and add:
```javascript
// Every 30 seconds, retry any positions that failed to close
if (Date.now() - lastRetryTime > 30000) {
  const retried = await positions.retryFailedCloses();
  if (retried > 0) log('info', `Retried ${retried} failed position closes`);
  lastRetryTime = Date.now();
}
```

- [ ] **Step 3: Commit**

```bash
git add positions.js index.js
git commit -m "feat: add retry mechanism for failed position closes"
```

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Verify sell success before marking closed | positions.js |
| 2 | Add on-chain balance verification | executor.js |
| 3 | Add retry mechanism for failed closes | positions.js, index.js |

---

## Testing Checklist

After implementation, verify:
- [ ] Failed sell keeps position open (not marked closed)
- [ ] Position only marked closed after on-chain confirmation
- [ ] Failed transactions show proper error messages
- [ ] Retry mechanism works for failed closes

---

## Plan complete

Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch subagent per task, review between tasks

**2. Inline Execution** - Execute tasks in this session using executing-plans

Which approach?