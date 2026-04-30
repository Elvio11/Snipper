# SniperBOT — OpenCode Agent Instructions

## Before Any Work

**Read `DEVELOPMENT_GUIDE.md` first** for project context and knowledge graph usage.

## Knowledge Graph (Required)

```
Location: graphify-out/graph.json
Interactive: graphify-out/graph.html
Report: graphify-out/GRAPH_REPORT.md
```

**Before answering project questions**, query the graph:
- `/graphify explain "<module>"` — understand a component
- `/graphify query "<topic>"` — find related code
- `/graphify path "A" "B"` — trace dependencies

## Graph Stats
- **562 nodes**, **1,009 edges**, **41 communities**
- **God nodes**: `log()` (most connected), `LyraClient`, `main()`

## Key Modules
- `src/modules/intelligence/` — Security scanning
- `src/modules/market-data/` — Price feeds
- `src/modules/technical-analysis/` — RSI, MACD, BB
- `src/modules/lyra-ecosystem/` — Tool discovery
- `src/vendors/market-data/` — Market data services
- `src/utils/` — Core utilities

## Update After Changes
```
/graphify . --update
```