# DexScreener Primary Scanner Design

## Overview
Replace Helius/PumpPortal as primary discovery source with direct DexScreener polling for new token pair discovery.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DexScreener Scanner                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │  Polling    │───▶│  Scoring     │───▶│  Candidate      │  │
│  │  (5 sec)    │    │  Engine      │    │  Queue          │  │
│  └─────────────┘    └──────────────┘    └────────┬────────┘  │
│                                                  │             │
│  ┌──────────────────────────────────────────────▼──────────┐  │
│  │              Execution Pipeline                      │  │
│  │  Validation → Buy → Position Tracking                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| DexScanner | `src/services/dex-scanner.js` | Polls getNewPairs() every 5s |
| ScoringEngine | Same file | Ranks pairs by liquidity + volume + recency |
| CandidateQueue | Same file | Holds top-scored pairs |

## Scoring Formula

```
Score = (liquidityUSD × 0.4) + (volume24h × 0.3) + (txns24h × 0.1) + (recencyBonus × 0.2)
```

**Min thresholds:**
- Liquidity ≥ $1,000
- Volume > $100
- At least 5 transactions

## Configuration (.env)

```
SCANNER_ENABLED=true
SCANNER_POLL_INTERVAL=5000
SCANNER_MIN_LIQUIDITY=1000
SCANNER_MIN_VOLUME=100
SCANNER_MIN_TXNS=5
SCANNER_MAX_CANDIDATES=3
SCANNER_SCORE_THRESHOLD=50
```

## Data Flow

1. getNewPairs() → returns newest 20 pairs
2. Filter: only Solana, only token pairs
3. Score each pair
4. Keep top 3-5 candidates in queue
5. For each candidate:
   - Re-validate liquidity via getTokenPairs()
   - Check not already in positions
   - Execute buyToken()
   - Add to positions on success

## Integration

- Reuses: buyToken(), positions, CONFIG, log()
- Can run alongside Helius/PumpPortal (configurable)
- If SCANNER_ENABLED=false, uses old flow only

## Error Handling

- API fails → wait 10s, retry
- Rate limited (429) → switch API URL via dexService
- No valid candidates → silent, next poll
- Buy fails → log, move to next candidate

## Files to Create/Modify

- Create: src/services/dex-scanner.js
- Modify: config.js (add SCANNER_* config)
- Modify: .env.example (add SCANNER_* defaults)
- Modify: index.js (integrate scanner)