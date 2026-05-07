# ⚡ Solana Sniper Bot

A high-performance Solana sniper bot designed for micro-cap tokens on Raydium and Pump.fun, utilizing Jupiter V1/V2 for optimized execution and a dual-wallet security model.

---

## 🚀 Key Features

- **Multi-Source Monitoring**: Scans Helius, Shinobi WebSocket, and DexScreener for new liquidity pools.
- **Dual-Wallet Security**: Uses a **Vault** (holds funds) and a **Signer** (executes trades). Automatically refills the Signer with gas SOL to keep your main private key offline/safe.
- **Jupiter V1/V2 Logic**: Prioritizes Jupiter V1 (Quote/Swap) for micro-amounts to avoid "Amount Too Small" errors, with V2 fallback for reliability.
- **Graduated Scaling**: Automatically grows trade size as your bankroll increases (Compounding mode).
- **Deep Safety Filters**:
  - **RugCheck.xyz**: Real-time safety score verification.
  - **Honeypot Simulation**: Verifies "sellability" via Jupiter quotes before buying.
  - **Contract Checks**: Mint authority, Freeze authority, and LP Burn verification.
- **Dynamic Slippage**: Adjusts slippage based on network volatility and pool depth.
- **Visual Dashboard**: Integrated React-based dashboard for real-time monitoring and trade management.

---

## 🛠️ Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) 18+
- Two Solana Wallets (One for Vault, one for Signer).

### 2. Installation
```bash
npm install
```

### 3. Configuration
Copy the template and fill in your details:
```bash
cp .env.example .env
```

**Essential variables to set:**
- `PRIVATE_KEY`: Your Vault wallet private key.
- `RPC_URL`: A high-quality RPC (Helius, QuickNode, or Triton).
- `HELIUS_API_KEY`: Required for advanced pool monitoring.

### 4. Generate Signer Wallet
Run this utility to generate a fresh signer wallet and get its address:
```bash
node scripts/generate-signer.js
```
Then add the private key to `SIGNER_PRIVATE_KEY` in `.env`.

---

## 📈 Usage

### Paper Trading (Simulation)
Test your strategy without risking real SOL:
```bash
npm run paper
```

### Live Trading
Start the sniper bot with PM2 for automatic restarts:
```bash
pm2 start ecosystem.config.cjs
```
Or run directly:
```bash
npm start
```

### 5. Web Dashboard
Monitor your bot visually:
```bash
npm run dashboard
```
Accessible at `http://localhost:3000`.

---

## 🛡️ Security Model: Signer vs Vault

This bot implements a **Hot/Cold wallet hybrid**:
1. **Vault (Cold)**: Stores your SOL. The bot only reads from here to check bankroll and sends gas refills.
2. **Signer (Hot)**: Holds only enough SOL for gas and the tokens currently being traded.
If the bot's environment is compromised, the majority of your funds stay safe in the Vault.

---

## 📊 Graduated Scaling

Enable `USE_GRADUATED_SCALING=true` to allow the bot to manage its own position sizing.
It uses the formula: `Bankroll * (Fraction / MaxPositions)`.
As you win trades, the bot will gradually increase the `BUY_AMOUNT_SOL` up to your defined caps.

---

## 📂 File Structure

- `index.js`: Main loop and orchestrator.
- `executor.js`: Jupiter execution logic (V1/V2).
- `monitor.js`: Pool detection and signal filtering.
- `safety.js`: Rug detection and honeypot checks.
- `positions.js`: Real-time TP/SL monitoring and P&L tracking.
- `wallet.js`: Multi-wallet management and gas refilling.
- `config.js`: Configuration and scaling logic.

---

## ⚠️ Disclaimer

Trading meme coins on Solana involves extreme risk. This bot is provided for educational purposes. Use at your own risk. The developers are not responsible for any financial losses.
