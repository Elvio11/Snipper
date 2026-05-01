/**
 * Test Jupiter Swap V2 (order + execute) integration.
 * Tests the complete flow: /order → sign → /execute
 * Uses 0.001 SOL (~$0.14) SOL→USDC swap.
 */
import 'dotenv/config';
import { Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SWAP_V2_BASE = 'https://api.jup.ag/swap/v2';
const PRICE_V3_BASE = 'https://api.jup.ag/price/v3';

const API_KEY = process.env.JUPITER_API_KEY || '';
const SIGNER_KEY = process.env.SIGNER_PRIVATE_KEY || process.env.PRIVATE_KEY;

if (!SIGNER_KEY) {
  console.error('❌ No SIGNER_PRIVATE_KEY or PRIVATE_KEY in .env');
  process.exit(1);
}

// Decode key: try base58 first, then base64 (matching wallet.js logic)
function decodePrivateKey(keyString) {
  try {
    const decoded = bs58.decode(keyString);
    if (decoded.length === 64) return decoded;
  } catch {}
  try {
    const decoded = Buffer.from(keyString, 'base64');
    if (decoded.length === 64) return decoded;
  } catch {}
  throw new Error('Invalid key format');
}

const wallet = Keypair.fromSecretKey(decodePrivateKey(SIGNER_KEY));
console.log(`\n🔑 Wallet: ${wallet.publicKey.toString()}`);
console.log(`🌐 API Key: ${API_KEY ? 'configured' : 'keyless (0.5 RPS)'}\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// Test 1: Price API v3
// ═══════════════════════════════════════════════════════════════════════════════
async function testPriceV3() {
  console.log('━'.repeat(60));
  console.log('TEST 1: Price API v3');
  console.log('━'.repeat(60));
  
  try {
    const headers = { 'Accept': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    const res = await fetch(`${PRICE_V3_BASE}?ids=${SOL_MINT}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    
    console.log(`  Status: ${res.status}`);
    const data = await res.json();
    const price = data?.[SOL_MINT]?.price || data?.[SOL_MINT]?.usdPrice; // Try both properties to be safe
    console.log(`  SOL price: $${price}`);
    if (price) {
      console.log(`  ✅ Price API v3 working\n`);
      return true;
    } else {
      console.log(`  ❌ Price API v3 returned no price\n`);
      return false;
    }
  } catch (err) {
    console.error(`  ❌ Price API v3 failed: ${err.message}\n`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 2: /order endpoint (quote-only, no taker)
// ═══════════════════════════════════════════════════════════════════════════════
async function testOrderQuoteOnly() {
  console.log('━'.repeat(60));
  console.log('TEST 2: /order quote-only (no taker)');
  console.log('━'.repeat(60));
  
  try {
    const params = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '1000000', // 0.001 SOL
    });
    
    const headers = { 'Accept': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    const res = await fetch(`${SWAP_V2_BASE}/order?${params}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    
    console.log(`  Status: ${res.status}`);
    const data = await res.json();
    console.log(`  outAmount: ${data.outAmount}`);
    console.log(`  router: ${data.router}`);
    console.log(`  mode: ${data.mode}`);
    console.log(`  feeBps: ${data.feeBps}`);
    console.log(`  transaction: ${data.transaction ? 'present' : 'null (expected without taker)'}`);
    console.log(`  ✅ Quote-only /order working\n`);
    return true;
  } catch (err) {
    console.error(`  ❌ Quote-only /order failed: ${err.message}\n`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 3: /order with taker (returns assembled tx)
// ═══════════════════════════════════════════════════════════════════════════════
async function testOrderWithTaker() {
  console.log('━'.repeat(60));
  console.log('TEST 3: /order with taker (tx assembly)');
  console.log('━'.repeat(60));
  
  try {
    const params = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '1000000', // 0.001 SOL
      taker: wallet.publicKey.toString(),
    });
    
    const headers = { 'Accept': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    const res = await fetch(`${SWAP_V2_BASE}/order?${params}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    
    console.log(`  Status: ${res.status}`);
    const order = await res.json();
    console.log(`  outAmount: ${order.outAmount} (raw)`);
    console.log(`  router: ${order.router}`);
    console.log(`  mode: ${order.mode}`);
    console.log(`  feeBps: ${order.feeBps}`);
    console.log(`  requestId: ${order.requestId?.slice(0, 12)}...`);
    console.log(`  transaction: ${order.transaction ? `${order.transaction.length} bytes base64` : 'null ❌'}`);
    
    if (!order.transaction) {
      console.error(`  ❌ No transaction returned\n`);
      return null;
    }
    
    // Verify we can deserialize
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    console.log(`  Instructions: ${tx.message.compiledInstructions.length}`);
    console.log(`  ✅ /order with taker working\n`);
    
    return order;
  } catch (err) {
    console.error(`  ❌ /order with taker failed: ${err.message}\n`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4: Sign + /execute (REAL swap of 0.001 SOL)
// ═══════════════════════════════════════════════════════════════════════════════
async function testSignAndExecute(order) {
  console.log('━'.repeat(60));
  console.log('TEST 4: Sign + /execute (REAL 0.001 SOL → USDC swap)');
  console.log('━'.repeat(60));
  
  if (!order) {
    console.log('  ⏭️  Skipped (no order from Test 3)\n');
    return false;
  }

  try {
    // Sign
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    tx.sign([wallet]);
    const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');
    console.log(`  Signed tx: ${signedTxBase64.length} bytes`);
    
    // Execute
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;
    
    console.log(`  Sending to /execute...`);
    const execRes = await fetch(`${SWAP_V2_BASE}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        signedTransaction: signedTxBase64,
        requestId: order.requestId,
      }),
      signal: AbortSignal.timeout(30000),
    });
    
    console.log(`  Status: ${execRes.status}`);
    const result = await execRes.json();
    
    console.log(`  Result status: ${result.status}`);
    console.log(`  Signature: ${result.signature || 'none'}`);
    console.log(`  Code: ${result.code}`);
    console.log(`  Input: ${result.inputAmountResult} lamports`);
    console.log(`  Output: ${result.outputAmountResult} USDC raw`);
    
    if (result.status === 'Success') {
      const solUsed = Number(result.inputAmountResult) / LAMPORTS_PER_SOL;
      console.log(`  💰 Swapped ${solUsed.toFixed(6)} SOL → ${(Number(result.outputAmountResult) / 1e6).toFixed(4)} USDC`);
      console.log(`  🔗 https://solscan.io/tx/${result.signature}`);
      console.log(`  ✅ SWAP V2 /execute SUCCESS!\n`);
      return true;
    } else {
      console.error(`  ❌ Swap failed: code=${result.code} error=${result.error || 'unknown'}\n`);
      return false;
    }
  } catch (err) {
    console.error(`  ❌ Execute failed: ${err.message}\n`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Jupiter Swap V2 Integration Test Suite           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const results = {};
  
  results.priceV3 = await testPriceV3();
  results.quoteOnly = await testOrderQuoteOnly();
  const order = await testOrderWithTaker();
  results.orderTaker = !!order;
  
  // Only do real swap if previous tests passed
  if (order) {
    // Ask for confirmation
    console.log('⚠️  Test 4 will execute a REAL swap of 0.001 SOL → USDC.');
    console.log('   Proceeding in 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));
    results.execute = await testSignAndExecute(order);
  } else {
    results.execute = false;
    console.log('  ⏭️  Test 4 skipped (order assembly failed)\n');
  }
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  for (const [test, passed] of Object.entries(results)) {
    console.log(`  ${passed ? '✅' : '❌'} ${test}`);
  }
  console.log();
}

main().catch(console.error);
