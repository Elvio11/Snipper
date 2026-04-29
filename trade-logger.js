import fs from 'fs';
import path from 'path';

const TRADE_LOG_PATH = path.join(process.cwd(), 'trade-history.jsonl');

export function logTrade(trade) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...trade,
  };

  try {
    fs.appendFileSync(TRADE_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to log trade:', err.message);
  }
}
