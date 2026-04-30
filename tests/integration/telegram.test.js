import { describe, it, expect } from 'vitest';
import { initTelegram } from '../../telegram.js';

describe('Telegram Integration', () => {
  it('should initialize telegram bot', async () => {
    const result = await initTelegram();
    console.log('Telegram init:', result);
  });
});