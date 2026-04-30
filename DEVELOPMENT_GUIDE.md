# SniperBOT Development Guide

## Project Overview
**SniperBOT** — Solana Meme Sniper Bot focused on Solana blockchain only.

### Core Features
- **Trading**: Jupiter (Solana DEX aggregator), Raydium (Solana AMM)
- **Security**: Token security scanning (DexScreener), honeypot detection
- **Price Feeds**: Birdeye, DexScreener, Raydium pool pricing
- **Wallet**: Phantom Wallet integration
- **Technical Analysis**: RSI, MACD, Bollinger Bands
- **Lyra Ecosystem**: Tool discovery, payments, registry

### Directory Structure (Solana-Only)
```
src/
├── modules/
│   ├── intelligence/      # Security scanning, audits
│   ├── lyra-ecosystem/  # Tool discovery & payments
│   ├── market-data/      # Price feeds, trading data
│   ├── technical-analysis/ # Indicators (RSI, MACD, BB)
│   └── utils/
├── utils/               # Core utilities
├── vendors/
│   └── market-data/    # Market data services
├── integrations/
├── sdk-generator/
└── server/
```

---

## Knowledge Graph

**Before any code work**, query the graph:
```
Location: graphify-out/graph.json
Interactive: graphify-out/graph.html
Report: graphify-out/GRAPH_REPORT.md
```

### Agent Workflow
1. Load `graphify-out/graph.json` for project questions
2. Query relevant nodes using graph tools
3. Cite source files from graph

### Key Commands
```bash
/graphify explain "module_name"    # Understand a component
/graphify query "topic"        # Find related code
/graphify path "A" "B"        # Trace dependencies
```

### Key Graph Stats
- **562 nodes** · **1,009 edges** · **41 communities**
- **God nodes**: `log()`, `LyraClient`, `main()`

---

## Update Graph After Changes
```bash
/graphify . --update
```

---

## Project Commands
- `npm run dev` - Start dev server
- `npm run build` - Build production
- `npm test` - Run tests