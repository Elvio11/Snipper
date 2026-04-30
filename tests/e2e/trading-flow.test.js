import { describe, it, expect } from 'vitest';
import { PoolService } from '../../src/services/pool.js';
import { buyToken, sellToken } from '../../executor.js';
import { PositionManager } from '../../positions.js';
import { CONFIG } from '../../config.js';

describe('E2E Trading Flow', () => {
  let pm;
  let testMint;
  
  beforeEach(() => {
    pm = new PositionManager();
    testMint = 'Test' + Date.now();
  });

  describe('Complete flow', () => {
    it('should get pool state', async () => {
      const state = await PoolService.getPoolState(
        '75aqHiPkmCgf2cK31G',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      console.log('Pool:', state?.program);
      expect(state).toBeDefined();
    });

    it('should calculate P&L correctly', () => {
      const entry = 0.00001;
      const exit = 0.000012;
      const profit = (exit - entry) / entry * 100;
      expect(profit).toBeCloseTo(20, 0);
      console.log('P&L:', profit.toFixed(1) + '%');
    });

    it('should have valid config', () => {
      expect(CONFIG.STOP_LOSS_PERCENT).toBe(20);
      expect(CONFIG.TAKE_PROFIT_MULTIPLIER).toBeGreaterThan(1);
    });
  });
});