import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PositionManager } from '../../positions.js';

describe('PositionManager Integration', () => {
  let pm;
  
  beforeEach(() => {
    pm = new PositionManager();
  });

  describe('add position', () => {
    it('should add a new position', async () => {
      const mint = 'TestAdd' + Date.now();
      const pos = await pm.add(mint, {
        tokenAmount: 1000000,
        pricePerToken: 0.00001,
        solSpent: 0.01,
        poolId: 'testPoolId'
      });
      
      expect(pos).toBeDefined();
    });
  });

  describe('getSummary', () => {
    it('should return summary', () => {
      const summary = pm.getSummary();
      console.log('Summary:', summary);
      expect(summary).toBeDefined();
    });
  });

  describe('clearStalePositions', () => {
    it('should handle stale cleanup', async () => {
      await pm.clearStalePositions();
    });
  });
});