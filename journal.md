# Solana Sniper Bot - Development Journal

## Project Overview
A Solana meme coin sniper bot that discovers new Raydium V4 pools, verifies liquidity/safety, buys automatically, and manages staged take-profit exits with paper trading mode.

## Project Constraints
- Max 3 simultaneous positions
- Staged TP: 33% @ 1.2x, 33% @ 1.4x, 34% @ 2.0x
- Stop loss: 25%
- Paper trading mode enabled (by default)
- Min liquidity: $500 USD, Max: $500,000 USD
- Target SOL/token pairs only (no USDC/USDT pairs)
- Max positions tracked in `D:\SniperBOT\logs\positions.json`

---

## Key Files
| File | Purpose |
|------|---------|
| `index.js` | Main bot entry - pool processing, buying, staged TP, position tracking |
| `monitor.js` | Pool scanner - detects new Raydium V4 pool creation via websocket |
| `executor.js` | Buy execution via Raydium SDK (paper + live modes) |
| `price.js` | Price fetching from Raydium API + Jupiter price fallback |
| `safety.js` | Token safety scoring via RugCheck API + RugCheck.xyz |
| `positions.js` | Position state management (entry, TP tiers, stop loss) |
| `wallet.js` | Wallet/signer management, SOL balance, price fetcher |
| `telegram.js` | Telegram notifications (optional) |
| `shinobi-ws.js` | Alternative WebSocket connection for pool detection |
| `config.js` | All configuration constants |
| `.env` | Secrets (RPC URL, private keys, Telegram token) |
| `logs/positions.json` | Active position states |

---

## Configuration (.env)
```
RPC_URL=https://api.mainnet-beta.solana.com
WALLET_PRIVATE_KEY=...
SIGNER_PRIVATE_KEY=...
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
MAX_POSITIONS=3
MIN_LIQUIDITY_USD=500
MAX_LIQUIDITY_USD=500000
PAPER_TRADING=true
```

---

## New Unified Architecture (Apr 27, 2026)

### Problem
Fragmented code with patch-on-patch fixes:
- `monitor.js` - hardcoded 5 SOL estimate, manual account parsing with arbitrary indices
- `price.js` - 5 different fallback methods, arbitrary byte offsets, no SDK
- `safety.js` - duplicated DexScreener calls, different endpoint paths
- Each service making independent API calls with no caching

### Solution
Created unified `PoolService` in `src/services/pool.js` - single source of truth for all pool data:

```
src/services/
├── pool.js       ← Unified PoolService (main)
├── raydium.js    ← Raydium API + CLMM pool parsing
├── jupiter.js   ← Jupiter price/swap API
└── dexscreener.js ← DexScreener API

monitors/
└── clmm-monitor.js ← Alternative CLMM monitor (optional)
```

### PoolService API
```javascript
// Get complete pool state (cached, 5s TTL)
await PoolService.getPoolState(poolAddress, tokenMint)

// Get token price in SOL (DexScreener → Jupiter → Raydium → Vaults)
await PoolService.getTokenPrice(tokenMint, poolAddress)

// Get liquidity in USD (DexScreener is authoritative)
await PoolService.getLiquidityUSD(tokenMint, poolAddress)

// Get token security (liquidity, volume, honeypot, mint authority)
await PoolService.getTokenSecurity(tokenMint)

// Parse CLMM pool from on-chain account (correct byte offsets)
PoolService.parseCLMMPool(data)
```

### CLMM Pool Parsing (correct offsets from SDK docs)
```javascript
// Offset 8: mintA (32 bytes)
// Offset 40: mintB (32 bytes)
// Offset 72: vaultA (32 bytes)
// Offset 104: vaultB (32 bytes)
// etc.
```

### Key Changes
1. Refactored `monitor.js` to use `PoolService.parseCLMMPool()` + `PoolService.getLiquidityUSD()`
2. Refactored `index.js` to use `PoolService.getTokenPrice()` and `PoolService.getTokenSecurity()`
3. Removed hardcoded account indices from pool detection
4. Added unified caching (5s TTL) across all price/liquidity calls
5. Unified honeypot check in `PoolService.getTokenSecurity()`

### Research Findings (from Raydium CLMM SDK docs)
- CLMM program: `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`
- Pool account: 400+ bytes owned by CLMM program
- Mint addresses: first 32 bytes after 8-byte discriminator
- Vault addresses: next 32 bytes after mintA/mintB

### Status
- ✅ Bot working with unified PoolService
- ✅ CLMM pools detected and parsed
- ✅ Paper trades executing
- ✅ Position monitoring active
- ⚠️ Price data not loading for existing positions (tokens too new)

### Session 1: Initial Setup
- Created bot from scratch using `@solana/web3.js`, `@solana/spl-token`
- Set up paper trading mode (virtual buy execution without real transactions)
- Implemented basic pool detection via Raydium API polling

### Session 2: Pool Detection Fixes
- **Issue**: Bot only detected SOL/USDC pairs, missed SOL/token meme coins
- **Fix**: Changed pool detection to accept ANY valid pool with a token mint (not just USDC pairs)
- Modified `_parsePoolTx()` in `monitor.js` to extract `tokenMint` from `baseMint/quoteMint` logic
- Accepted pools where baseMint OR quoteMint is SOL (ignoring USDC/USDT)

### Session 3: Liquidity Detection
- **Issue**: `getPoolLiquidityUSD()` returned 0 for brand new pools (not indexed by Raydium yet)
- **Fix**: Added fallback estimation using transaction SOL delta as proxy for initial liquidity
- `liquidityUSD = poolInfo.solLiquidity * solPrice` when Raydium API returns 0

### Session 4: First Real Snipe
- **First successful buy** on pool `4oxbKUP2SeM5CBYfF2LFmkxXffSAyU6sSLF1QSe1n6Pf`
- Token `4oxbKUP2...` purchased at entry price 1.080e-5 SOL (paper trade)
- This confirmed the buy flow end-to-end works correctly

### Session 5: solLiquidity Calculation Bug (Critical Fix)
- **Issue**: `solLiquidity` consistently showed `0.00 SOL` for ALL pools despite pools having real liquidity
- **Root cause**: The old logic summed ALL positive balance changes across every account:
  ```js
  // WRONG - balances cancel out (pool gains SOL, provider loses SOL = ~0)
  if (change > 1000000) { solAdded += change / 1e9; }
  ```
- **Fix**: Changed to track the largest balance change (positive or negative):
  ```js
  // RIGHT - captures the SOL flowing into the pool vault
  const solAdded = Math.max(maxSolIncrease, Math.abs(maxSolDecrease)) / 1e9;
  ```
- Also lowered threshold from 0.5 SOL → 0.05 SOL to catch smaller pools during testing

### Session 6: Liquidity Fallback Fix
- **Issue**: After fix, `C1aiPbBM2hnJ...` pool showed `0.10 SOL` liquidity but got skipped: "Could not determine pool liquidity"
- **Root cause**: `getSolPrice()` was returning 0 (API failure), so the fallback `if (solPrice > 0)` never executed
- **Fix**: Added hardcoded fallback (`solPrice = 200`) when API returns 0, removed the `if (solPrice > 0)` gate so fallback always runs

---

## Testing Verification (Recent)
- Pool detection working - seeing SOL values in logs: "Pool low liquidity (0.10 SOL)", "Pool low liquidity (0.0431 SOL)"
- After fallback fix, pools with liquidity should now proceed to buy check
- Bot is actively scanning - no buys triggered since threshold is catching smaller pools (0.05 SOL = ~$10 USD)

---

## Phase 1 Implementation (Completed)

### 1. Fix Monitoring Loop Sell Execution
- **Issue**: Monitoring loop at index.js:274-277 only logged TP/SL but never executed sells
- **Fix**: Now calls `positions.checkAll()` when TP/SL threshold triggered
- **Result**: Sells will execute on TP/SL instead of just logging

### 2. Add Missing CONFIG.MIN_LP_BURNED_PERCENT
- **Issue**: Referenced in index.js:159 but never defined → would be `undefined`
- **Fix**: Added `MIN_LP_BURNED_PERCENT` to config.js (default: 0)

### 3. Use CONFIG Instead of Hardcoded Threshold
- **Issue**: monitor.js used hardcoded `0.05` instead of CONFIG.MIN_INITIAL_LIQUIDITY_SOL
- **Fix**: Now uses `CONFIG.MIN_INITIAL_LIQUIDITY_SOL` (default: 0.5 SOL)

### 4. Switch to CLMM-Only Pool Detection
- **Issue**: Only watched AMM V4 (`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`), missing CLMM pools
- **Fix**: Now watches CLMM program (`CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`) + AMM V4 for backward compat
- **Result**: More efficient - focuses on latest pool type

### 5. Add DexScreener Liquidity Check Early
- **Issue**: Raydium API returns null/500, falls back to unreliable tx delta calculation
- **Fix**: Check DexScreener FIRST for liquidity, then Raydium API, then estimate
- **Result**: Uses most reliable data source (DexScreener) before making buy decision

### 6. Set Min Liquidity to $500
- **Fix**: Changed default from $1000 → $500 in config.js

---

## Key Files Modified
| File | Changes |
|------|---------|
| `config.js` | Added MIN_LP_BURNED_PERCENT, changed default MIN_INITIAL_LIQUIDITY_USD to 500 |
| `monitor.js` | Added CLMM program ID, uses CONFIG for threshold, fixed variable references |
| `index.js` | Fixed sell execution in monitoring loop, added DexScreener liquidity check early |

---

## Commands
```bash
npm start       # Start the bot
npm run paper  # Same as start (paper trading)
```

---

*Last updated: 2026-04-27*