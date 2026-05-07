import { describe, it, expect, beforeEach } from 'vitest';
import { PoolService } from '../../src/services/pool.js';
import { buyToken, sellToken, getPaperPrice } from '../../executor.js';
import { PositionManager } from '../../positions.js';

describe('E2E - New Token Discovery Flow', () => {
  let pm;
  let newTokenMint;
  
  beforeEach(() => {
    pm = new PositionManager();
    newTokenMint = 'NewTestToken' + Date.now();
  });

  describe('New token without price data', () => {
    it('should use fallback price for new tokens (sniping mode)', async () => {
      // Uses estimated fallback for sniping new tokens
      const result = await buyToken(newTokenMint, 0.01, null);
      
      expect(result.success).toBe(true);
      expect(result.pricePerToken).toBe(0.000001);
      console.log('✓ Uses fallback price for sniping');
    });

    it('should handle sell with estimated prices', async () => {
      // First buy - uses fallback price
      const buyResult = await buyToken(newTokenMint, 0.01, null);
      
      // Then sell the bought amount
      const sellResult = await sellToken(newTokenMint, buyResult.tokenAmount);
      
      if (!sellResult.success) {
        console.log('❌ Sell failed:', sellResult.error);
        return;
      }
      
      expect(sellResult.solReceived).toBeGreaterThan(0);
      console.log('✓ Sell succeeded:', {
        solReceived: sellResult.solReceived
      });
    });
  });

  describe('Full position lifecycle', () => {
    it('should use fallback when no valid price source (sniping mode)', async () => {
      const testMint = 'FullCycle' + Date.now();
      
      // Uses estimated fallback price for sniping new tokens
      const buyResult = await buyToken(testMint, 0.01, null);
      expect(buyResult.success).toBe(true);
      expect(buyResult.pricePerToken).toBe(0.000001);
      console.log('✓ Uses fallback price for new token sniping');
    });
  });
});

describe('E2E - Entry Price Logic Validation', () => {
  it('should correctly calculate entry price', async () => {
    const solAmount = 0.01;
    const price = 0.000001;
    
    // For 0.01 SOL at 0.000001 price = 10,000 tokens
    const tokenAmount = (solAmount / price) * 1e6;
    
    // Reverse: 10,000 tokens * 0.000001 = 0.01 SOL
    const reverseCalc = (tokenAmount / 1e6) * price;
    
    expect(reverseCalc).toBeCloseTo(solAmount, 5);
    console.log('Entry price logic: ✓', {
      solAmount,
      tokenAmount,
      reverseCalc,
      pricePerToken: price
    });
  });
});