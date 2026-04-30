import { describe, it, expect } from 'vitest';
import { buyToken, getPaperPrice } from '../../executor.js';

describe('Executor - Paper Trading', () => {
  it('should use estimated fallback price for unknown mint', async () => {
    const result = await buyToken('RandomMintNoPrice' + Date.now(), 0.01, null);
    // Falls back to estimated price for sniping new tokens
    expect(result.success).toBe(true);
    expect(result.pricePerToken).toBe(0.000001);
    console.log('✓ Uses fallback price:', result.pricePerToken);
  });
});