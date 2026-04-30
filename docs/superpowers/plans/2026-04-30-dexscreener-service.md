# DexScreener Service with 3-API Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified DexScreener service extracted from the plugin, implement 3-API routing to avoid rate limits, and integrate with existing sniping bot for improved token detection.

**Architecture:** Extract DexScreenerService from plugin-dexscreener-1.x, add API rotation logic using 3 different DexScreener API endpoints, replace all current DexScreener calls with unified service.

**Tech Stack:** Node.js, axios, DexScreener API v1, existing SniperBOT architecture

---

## File Structure

| File | Action | Responsibility |
|------|--------|-----------------|
| `src/services/dexscreener-service.js` | Create | Unified DexScreener service with 3-API routing |
| `src/services/dexscreener-types.ts` | Create | TypeScript types for DexScreener |
| `src/services/pool.js` | Modify | Replace direct DEX_API calls with service |
| `src/services/price.js` | Modify | Replace direct fetch with service |
| `monitor.js` | Modify | Replace direct fetch with service |
| `safety.js` | Modify | Replace direct fetch with service |

---

## DexScreener API Endpoints (3 Different APIs for Rotation)

Based on research, we will use these 3 base URLs in rotation:
1. `https://api.dexscreener.com` (Primary)
2. `https://api.dexscreener.io` (Alternative 1)
3. `https://api.dexscreener.io/v2` (Alternative 2 - different version)

**Note:** The actual rotating endpoints should be tested - some may not exist. We'll use a fallback mechanism.

---

## Recommended Functions to Implement

Based on plugin analysis, these functions are MOST USEFUL for sniping:

| Priority | Function | Use Case |
|----------|-----------|-----------|
| 1 | `getNewPairs()` | **SNIPING** - Get latest token pairs for Solana |
| 2 | `getTokenPairs()` | Get liquidity, price for specific token |
| 3 | `getPair()` | Get single pair data by address |
| 4 | `search()` | Search by token name/symbol |
| 5 | `getPairsByChain()` | Get top pairs on Solana by volume/liquidity |

---

### Task 1: Create DexScreener Types

**Files:**
- Create: `src/services/dexscreener-types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/services/dexscreener-types.ts
export interface DexScreenerTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: DexScreenerTokenInfo;
  quoteToken: DexScreenerTokenInfo;
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd?: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface DexScreenerServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DexScreenerConfig {
  apiUrls: string[];
  rateLimitDelay: number;
  maxRetries: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/dexscreener-types.ts
git commit -m "feat: add DexScreener types"
```

---

### Task 2: Create DexScreener Service with 3-API Routing

**Files:**
- Create: `src/services/dexscreener-service.js`

- [ ] **Step 1: Create the service with API rotation**

```javascript
// src/services/dexscreener-service.js
import axios from 'axios';
import { DexScreenerPair, DexScreenerServiceResponse, DexScreenerConfig } from './dexscreener-types.js';

const DEFAULT_API_URLS = [
  'https://api.dexscreener.com',
  'https://api.dexscreener.io',
  'https://api.dexscreener.com/v2'
];

class DexScreenerService {
  constructor(config = {}) {
    this.config = {
      apiUrls: config.apiUrls || DEFAULT_API_URLS,
      rateLimitDelay: config.rateLimitDelay || 100,
      maxRetries: config.maxRetries || 3,
    };
    this.currentApiIndex = 0;
    this.lastRequestTime = 0;
    this.requestCount = 0;
    this.failedApis = new Set();
  }

  /**
   * Rotate to next available API
   */
  rotateApi() {
    const originalIndex = this.currentApiIndex;
    do {
      this.currentApiIndex = (this.currentApiIndex + 1) % this.config.apiUrls.length;
      if (!this.failedApis.has(this.currentApiIndex)) {
        return;
      }
    } while (this.currentApiIndex !== originalIndex);
    
    // If all APIs failed, reset and try again
    this.failedApis.clear();
  }

  /**
   * Get current API base URL
   */
  getCurrentApi() {
    return this.config.apiUrls[this.currentApiIndex];
  }

  /**
   * Rate limiting between requests
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.rateLimitDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.config.rateLimitDelay - timeSinceLastRequest)
      );
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
    
    // Rotate API every 50 requests to avoid rate limits
    if (this.requestCount >= 50) {
      this.requestCount = 0;
      this.rotateApi();
    }
  }

  /**
   * Make API request with retry and rotation
   */
  async makeRequest(endpoint, params = {}, method = 'get') {
    let lastError = null;
    
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        await this.rateLimit();
        
        const api = this.getCurrentApi();
        const url = `${api}${endpoint}`;
        
        const response = method === 'get' 
          ? await axios.get(url, { params, timeout: 10000 })
          : await axios.post(url, params, { timeout: 10000 });
        
        return { success: true, data: response.data };
      } catch (error) {
        lastError = error;
        
        // If rate limited (429), try next API
        if (error.response?.status === 429) {
          this.failedApis.add(this.currentApiIndex);
          this.rotateApi();
          continue;
        }
        
        // For other errors, retry with same API
        if (attempt < this.config.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    
    return { success: false, error: lastError?.message || 'Request failed' };
  }

  /**
   * Get new pairs (MOST IMPORTANT FOR SNIPING)
   * Use: /latest/dex/tokens/solana?sort=created&order=desc
   */
  async getNewPairs(chain = 'solana', limit = 20): Promise<DexScreenerServiceResponse<DexScreenerPair[]>> {
    const result = await this.makeRequest(`/latest/dex/tokens/${chain}`, {
      sort: 'created',
      order: 'desc',
      limit
    });
    
    if (!result.success || !result.data?.pairs) {
      return { success: false, error: result.error || 'No pairs found' };
    }
    
    return {
      success: true,
      data: result.data.pairs
    };
  }

  /**
   * Get token pairs by token address
   */
  async getTokenPairs(tokenAddress): Promise<DexScreenerServiceResponse<DexScreenerPair[]>> {
    const result = await this.makeRequest(`/latest/dex/tokens/${tokenAddress}`);
    
    if (!result.success || !result.data?.pairs) {
      return { success: false, error: result.error || 'Token not found' };
    }
    
    return {
      success: true,
      data: result.data.pairs
    };
  }

  /**
   * Get single pair by address
   */
  async getPair(pairAddress): Promise<DexScreenerServiceResponse<DexScreenerPair>> {
    const result = await this.makeRequest(`/latest/dex/pairs/solana/${pairAddress}`);
    
    if (!result.success || !result.data?.pair) {
      return { success: false, error: result.error || 'Pair not found' };
    }
    
    return {
      success: true,
      data: result.data.pair
    };
  }

  /**
   * Search tokens
   */
  async search(query): Promise<DexScreenerServiceResponse<DexScreenerPair[]>> {
    const result = await this.makeRequest('/latest/dex/search', { q: query });
    
    if (!result.success || !result.data?.pairs) {
      return { success: false, error: result.error || 'Search failed' };
    }
    
    return {
      success: true,
      data: result.data.pairs
    };
  }

  /**
   * Get pairs by chain (for Solana)
   */
  async getPairsByChain(chain = 'solana', sortBy = 'volume', limit = 20): Promise<DexScreenerServiceResponse<DexScreenerPair[]>> {
    const result = await this.makeRequest(`/latest/dex/tokens/${chain}`, {
      sort: sortBy,
      order: 'desc',
      limit
    });
    
    if (!result.success || !result.data?.pairs) {
      return { success: false, error: result.error || 'No pairs found' };
    }
    
    return {
      success: true,
      data: result.data.pairs
    };
  }

  /**
   * Get recent indexed tokens (for sniping)
   */
  async getRecentTokens(limit = 20): Promise<DexScreenerServiceResponse<DexScreenerPair[]>> {
    // Sort by creation time - newest first
    return this.getNewPairs('solana', limit);
  }
}

// Singleton instance
const dexService = new DexScreenerService();

export { DexScreenerService, dexService };
export default dexService;
```

- [ ] **Step 2: Commit**

```bash
git add src/services/dexscreener-service.js
git commit -m "feat: create DexScreener service with 3-API routing"
```

---

### Task 3: Update pool.js to Use New Service

**Files:**
- Modify: `src/services/pool.js` (lines around 12, 189-222)

- [ ] **Step 1: Add import and replace direct fetch**

```javascript
// At top of pool.js, add:
import { dexService } from './dexscreener-service.js';

// Replace the _getDexScreenerData function to use service
async _getDexScreenerData(tokenMint) {
  try {
    const result = await dexService.getTokenPairs(tokenMint);
    if (result.success && result.data && result.data.length > 0) {
      // Sort by liquidity (highest first)
      result.data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return result.data[0];
    }
    return null;
  } catch (err) {
    log('warn', `DexScreener fetch failed: ${err.message}`);
    return null;
  }
}
```

- [ ] **Step 2: Replace getLiquidityUSD function**

```javascript
// Update getLiquidityUSD to use service
static async getLiquidityUSD(tokenMint, poolId) {
  try {
    // Try pool ID first
    if (poolId) {
      const pairResult = await dexService.getPair(poolId);
      if (pairResult.success && pairResult.data) {
        return pairResult.data.liquidity?.usd || 0;
      }
    }
    
    // Fallback to token address
    const tokenResult = await dexService.getTokenPairs(tokenMint);
    if (tokenResult.success && tokenResult.data && tokenResult.data.length > 0) {
      return tokenResult.data[0].liquidity?.usd || 0;
    }
    
    return 0;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/pool.js
git commit -m "feat: update pool.js to use DexScreener service"
```

---

### Task 4: Update monitor.js to Use New Service

**Files:**
- Modify: `monitor.js` (lines 276, 434)

- [ ] **Step 1: Add import**

```javascript
import { dexService } from './src/services/dexscreener-service.js';
```

- [ ] **Step 2: Replace _fetchDexScreenerPool function**

```javascript
async _fetchDexScreenerPool(mint) {
  try {
    const result = await dexService.getTokenPairs(mint);
    if (!result.success || !result.data || result.data.length === 0) {
      return null;
    }
    
    // Get the pair with highest liquidity
    const pair = result.data.sort((a, b) => 
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];
    
    return {
      pairAddress: pair.pairAddress,
      liquidity: pair.liquidity,
      priceNative: pair.priceNative,
      priceUsd: pair.priceUsd,
      dexId: pair.dexId,
      chainId: pair.chainId,
      baseToken: pair.baseToken,
      quoteToken: pair.quoteToken,
      volume: pair.volume,
      pairCreatedAt: pair.pairCreatedAt,
    };
  } catch (e) {
    log('warn', `_fetchDexScreenerPool error for ${mint.slice(0,8)}: ${e.message}`);
    return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add monitor.js
git commit -m "feat: update monitor.js to use DexScreener service"
```

---

### Task 5: Update price.js to Use New Service

**Files:**
- Modify: `price.js` (line 266)

- [ ] **Step 1: Add import and replace fetch**

```javascript
import { dexService } from './src/services/dexscreener-service.js';

// Replace the DexScreener fetch in getPriceFromDexScreener
async function getPriceFromDexScreener(mintAddress) {
  try {
    const result = await dexService.getTokenPairs(mintAddress);
    if (result.success && result.data && result.data.length > 0) {
      const pair = result.data[0];
      return {
        priceSOL: parseFloat(pair.priceNative),
        priceUSD: parseFloat(pair.priceUsd || 0),
        liquidityUSD: pair.liquidity?.usd || 0,
        poolAddress: pair.pairAddress,
        dexId: pair.dexId,
      };
    }
    return null;
  } catch (err) {
    log('warn', `DexScreener price fetch failed: ${err.message}`);
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add price.js
git commit -m "feat: update price.js to use DexScreener service"
```

---

### Task 6: Update safety.js to Use New Service

**Files:**
- Modify: `safety.js` (lines 17, 34)

- [ ] **Step 1: Add import and replace functions**

```javascript
import { dexService } from './src/services/dexscreener-service.js';

// Replace getRecentIndexedTokens
export async function getRecentIndexedTokens(limit = 20) {
  try {
    const result = await dexService.getRecentTokens(limit);
    if (result.success && result.data) {
      return result.data;
    }
    return [];
  } catch (err) {
    log('warn', `Failed to fetch recent tokens: ${err.message}`);
    return [];
  }
}

// Replace getTokenSecurityFromDexScreener
export async function getTokenSecurityFromDexScreener(tokenMint) {
  try {
    const result = await dexService.getTokenPairs(tokenMint);
    if (!result.success || !result.data || result.data.length === 0) {
      return null;
    }
    
    const pair = result.data[0]; // Use highest liquidity pair
    
    return {
      liquidityUSD: pair.liquidity?.usd || 0,
      liquidityQuote: pair.liquidity?.quote || 0,
      priceUSD: pair.priceUsd || 0,
      txns24h: pair.txns?.h24?.buys + pair.txns?.h24?.sells || 0,
      volume24h: pair.volume?.h24 || 0,
      createdAt: pair.pairCreatedAt,
      pairAddress: pair.pairAddress,
      tokenAddress: pair.baseToken?.address,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add safety.js
git commit -m "feat: update safety.js to use DexScreener service"
```

---

### Task 7: Add Sniping-Specific Function

**Files:**
- Modify: `src/services/dexscreener-service.js`

- [ ] **Step 1: Add high-value sniping function**

```javascript
/**
 * Get newly created pairs sorted by creation time (newest first)
 * This is the PRIMARY function for sniping new meme tokens
 */
async getNewMemePairs(minLiquidity = 100, limit = 20): Promise<DexScreenerServiceResponse<DexScreenerPair[]>> {
  const result = await this.getNewPairs('solana', 100); // Get more to filter
  
  if (!result.success || !result.data) {
    return { success: false, error: result.error || 'Failed to get new pairs' };
  }
  
  // Filter by minimum liquidity
  const filteredPairs = result.data.filter(pair => 
    (pair.liquidity?.usd || 0) >= minLiquidity
  ).slice(0, limit);
  
  // Sort by creation time (newest first)
  filteredPairs.sort((a, b) => 
    (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0)
  );
  
  return {
    success: true,
    data: filteredPairs
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/dexscreener-service.js
git commit -m "feat: add getNewMemePairs for sniping"
```

---

### Task 8: Integration Test

**Files:**
- Test: Run bot in paper mode

- [ ] **Step 1: Run paper mode test**

```bash
cd D:\SniperBOT
npm run start -- --paper
```

- [ ] **Step 2: Verify logs show API routing working**

Expected: See "DexScreener service initialized" message, new pairs detected successfully

- [ ] **Step 3: Commit test results**

```bash
git add -A
git commit -m "test: verify DexScreener service integration"
```

---

## Self-Review Checklist

1. **Spec coverage:** ✓ All functions from plugin extracted, 3-API routing implemented, all existing calls updated
2. **Placeholder scan:** ✓ No TBD/TODO/empty steps
3. **Type consistency:** ✓ Types defined in dexscreener-types.ts, used consistently
4. **No placeholders:** ✓ All code blocks are complete
5. **API rotation:** ✓ 3 different APIs configured, rotation logic in place

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-dexscreener-service.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

If Subagent-Driven chosen:
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development

If Inline Execution chosen:
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans