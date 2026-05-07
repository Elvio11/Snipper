import { analyzeToken } from './safety.js';
import { log } from './logger.js';
import { CONFIG } from './config.js';
import { getSolPrice } from './wallet.js';

async function test() {
  const mint = process.argv[2];
  if (!mint) {
    console.log('Usage: node test-threshold.js <mint_address>');
    process.exit(1);
  }

  // Set SOL price in config
  const price = await getSolPrice();
  CONFIG._solPrice = price;
  log('info', `Current SOL Price: $${price}`);

  log('info', `Testing threshold for: ${mint}`);
  const result = await analyzeToken(mint);
  
  console.log('\n--- Analysis Result ---');
  console.log('Safe:', result.safe);
  console.log('Score:', result.score);
  console.log('Reasons:');
  result.reasons.forEach(r => console.log(' ', r));
}

test().catch(console.error);
