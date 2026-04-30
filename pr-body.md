## Summary
- Add unified DexScreener service with 3-API URL rotation to avoid rate limits
- Create TypeScript types for DexScreener data
- Update pool.js to use new dexService
- Add getNewMemePairs() for sniping new tokens
- Fix axios dependency - use native fetch instead
- 8 prior commits for Jupiter SDK integration, paper mode fixes, etc.

## Key Files
- src/services/dexscreener-service.js - Unified service
- src/services/dexscreener-types.ts - Types
- src/services/pool.js - Updated to use dexService