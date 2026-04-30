// src/services/dexscreener-service.js
import axios from 'axios';

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

  rotateApi() {
    const originalIndex = this.currentApiIndex;
    do {
      this.currentApiIndex = (this.currentApiIndex + 1) % this.config.apiUrls.length;
      if (!this.failedApis.has(this.currentApiIndex)) {
        return;
      }
    } while (this.currentApiIndex !== originalIndex);
    
    this.failedApis.clear();
  }

  getCurrentApi() {
    return this.config.apiUrls[this.currentApiIndex];
  }

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
    
    if (this.requestCount >= 50) {
      this.requestCount = 0;
      this.rotateApi();
    }
  }

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
        
        if (error.response?.status === 429) {
          this.failedApis.add(this.currentApiIndex);
          this.rotateApi();
          continue;
        }
        
        if (attempt < this.config.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    
    return { success: false, error: lastError?.message || 'Request failed' };
  }

  async getNewPairs(chain = 'solana', limit = 20) {
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

  async getTokenPairs(tokenAddress) {
    const result = await this.makeRequest(`/latest/dex/tokens/${tokenAddress}`);
    
    if (!result.success || !result.data?.pairs) {
      return { success: false, error: result.error || 'Token not found' };
    }
    
    return {
      success: true,
      data: result.data.pairs
    };
  }

  async getPair(pairAddress) {
    const result = await this.makeRequest(`/latest/dex/pairs/solana/${pairAddress}`);
    
    if (!result.success || !result.data?.pair) {
      return { success: false, error: result.error || 'Pair not found' };
    }
    
    return {
      success: true,
      data: result.data.pair
    };
  }

  async search(query) {
    const result = await this.makeRequest('/latest/dex/search', { q: query });
    
    if (!result.success || !result.data?.pairs) {
      return { success: false, error: result.error || 'Search failed' };
    }
    
    return {
      success: true,
      data: result.data.pairs
    };
  }

  async getPairsByChain(chain = 'solana', sortBy = 'volume', limit = 20) {
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

  async getRecentTokens(limit = 20) {
    return this.getNewPairs('solana', limit);
  }

  async getNewMemePairs(minLiquidity = 100, limit = 20) {
    const result = await this.getNewPairs('solana', 100);
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to get new pairs' };
    }
    
    const filteredPairs = result.data.filter(pair => 
      (pair.liquidity?.usd || 0) >= minLiquidity
    ).slice(0, limit);
    
    filteredPairs.sort((a, b) => 
      (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0)
    );
    
    return {
      success: true,
      data: filteredPairs
    };
  }
}

const dexService = new DexScreenerService();

export { DexScreenerService, dexService };
export default dexService;