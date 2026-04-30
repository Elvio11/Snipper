// Quick test script for paper mode flow
import { CONFIG } from './config.js';
import { buyToken, sellToken } from './executor.js';
import { PositionManager } from './positions.js';

// Mock token for testing
const TEST_MINT = '7nmZEFL6Bn7dxRzx6YB8jB2kSs6diTBk8vKQWkPXnc'; // Some random mint
const TEST_POOL = '11111111111111111111111111111111';

console.log('\n🧪 Testing Paper Mode Flow...\n');

// Test 1: Buy
console.log('Test 1: Paper Buy...');
const buyResult = await buyToken(TEST_MINT, 0.01, TEST_POOL);
console.log('Buy result:', buyResult);

// Test 2: Sell  
if (buyResult.success) {
  console.log('\nTest 2: Paper Sell...');
  const sellResult = await sellToken(TEST_MINT, buyResult.tokenAmount);
  console.log('Sell result:', sellResult);
}

// Test 3: Position Manager
console.log('\nTest 3: Position Manager...');
const pm = new PositionManager();
console.log('Open positions:', pm.count());

console.log('\n✅ All paper mode tests complete!\n');
process.exit(0);
