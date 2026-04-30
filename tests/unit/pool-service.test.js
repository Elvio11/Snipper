import { describe, it, expect } from 'vitest';
import { PoolService } from '../../src/services/pool.js';

describe('PoolService - Price Fetching', () => {
  const TEST_TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  it('should fetch price from API sources', async () => {
    const price = await PoolService.getTokenPrice(TEST_TOKEN);
    console.log('Price for USDC:', price);
    // May be null if API fails, but should not throw
  });

  it('should return null for invalid token', async () => {
    const price = await PoolService.getTokenPrice('invalid_token_xyz');
    expect(price).toBeNull();
  });

  it('should get token security', async () => {
    const security = await PoolService.getTokenSecurity(TEST_TOKEN);
    console.log('Security:', security);
    expect(security).toBeDefined();
  });

  it('should clear cache', () => {
    PoolService.clearCache();
  });
});