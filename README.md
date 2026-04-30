# ⚡ Solana Meme Sniper Bot

Monitors Raydium for new liquidity pools, runs safety checks, and automatically buys/sells meme tokens.

---

## ⚠️ Risk Warning

Meme coin trading is **extremely high risk**. Most tokens go to zero. This bot does not guarantee profits. With $5 (~0.03 SOL), one bad trade can eliminate your entire capital. **Only use funds you can afford to lose completely.**

---

## Setup

### 1. Prerequisites
- Node.js 18+
- A Solana wallet (Phantom recommended)
- SOL for trading + gas fees

### 2. Install
```bash
npm install
```

### 3. Configure
```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Your wallet private key (base58, from Phantom → Settings → Export Private Key) |
| `RPC_URL` | Solana RPC endpoint — **use a paid one for speed** |
| `BUY_AMOUNT_SOL` | SOL to spend per trade (e.g. `0.01`) |
| `TAKE_PROFIT_MULTIPLIER` | Sell when price hits Nx entry (e.g. `3` = 3x) |
| `STOP_LOSS_PERCENT` | Sell when price drops X% (e.g. `40`) |

### 4. Get a fast RPC (critical)

Free RPCs are too slow — you'll lose to other bots. Get a free API key from:
- **Helius** — https://helius.xyz (recommended, generous free tier)
- **QuickNode** — https://quicknode.com
- **Triton** — https://triton.one

Then set in `.env`:
```
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

---

## Usage

### Paper trading (no real money — START HERE)
```bash
npm run paper
# or
node src/index.js --paper
```

### Live trading
```bash
npm start
```

---

## How It Works

```
New Raydium pool detected (WebSocket)
         ↓
  Liquidity check ($1K–$500K)
         ↓
  LP burn % check (optional)
         ↓
  Token safety analysis:
    • Mint authority revoked?
    • Freeze authority revoked?
    • Honeypot simulation (Jupiter quote)
         ↓
  BUY via Jupiter (best price routing)
         ↓
  Monitor price every 10 seconds
         ↓
  SELL at take-profit OR stop-loss
```

---

## Safety Filters

| Check | What it catches |
|---|---|
| Mint authority | Devs printing infinite tokens |
| Freeze authority | Devs freezing your wallet |
| Honeypot simulation | Tokens you can buy but not sell |
| Liquidity range | Too small (rug) or too pumped |
| LP burn % | Devs who can pull liquidity |

---

## Recommended Settings for $5

```env
BUY_AMOUNT_SOL=0.008          # ~$1.30 per trade
TAKE_PROFIT_MULTIPLIER=4      # sell at 4x
STOP_LOSS_PERCENT=35          # cut losses at -35%
MAX_POSITIONS=2               # never hold more than 2
MIN_LIQUIDITY_USD=2000        # avoid micro-rugs
REQUIRE_FREEZE_REVOKED=true
HONEYPOT_CHECK=true
```

---

## Files

```
src/
  index.js      — Main orchestrator
  monitor.js    — Raydium WebSocket pool watcher
  safety.js     — Token safety analysis
  executor.js   — Jupiter buy/sell execution
  positions.js  — Position tracking + P&L
  price.js      — Price feeds
  wallet.js     — Wallet + connection
  config.js     — Config loader
  logger.js     — Logging

logs/
  trades.log    — All trade history (JSON)
  positions.json — Open/closed positions
  error.log     — Errors
```

---

## Logs

All trades are saved to `logs/positions.json`. Each entry includes entry price, exit price, P&L in SOL, and close reason (take_profit / stop_loss).
