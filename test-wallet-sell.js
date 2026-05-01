import 'dotenv/config';
import { getWallet, getConnection } from './wallet.js';
import { sellToken } from './executor.js';
import { log } from './logger.js';
import { PublicKey } from '@solana/web3.js';

async function testSell() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              TEST SELL WITH EXISTING TOKENS           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log();

  const conn = getConnection();
  const wallet = getWallet();
  
  console.log(`Wallet: ${wallet.publicKey.toString()}`);
  
  // Check SOL balance
  const solBalance = await conn.getBalance(wallet.publicKey);
  console.log(`SOL Balance: ${(solBalance / 1e9).toFixed(6)} SOL`);
  console.log();

  // Get all token accounts
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });

  if (tokenAccounts.value.length === 0) {
    console.log('No token accounts found!');
    return;
  }

  console.log('Token Accounts:');
  console.log('──────────────────────────────────────────────');
  
  for (const account of tokenAccounts.value) {
    const data = account.account.data.parsed.info;
    if (parseInt(data.amount) > 0) {
      console.log(`Mint: ${data.mint.slice(0, 20)}...`);
      console.log(`Balance: ${data.tokenAmount.uiAmountString}`);
      console.log(`Decimals: ${data.tokenAmount.decimals}`);
      console.log(`Raw: ${data.amount}`);
      console.log('──────────────────────────────────────────────');
    }
  }

  // Test selling a small portion of the first token with balance
  const testToken = tokenAccounts.value.find(a => parseInt(a.account.data.parsed.info.amount) > 0);
  
  if (testToken) {
    const mint = testToken.account.data.parsed.info.mint;
    const balance = parseInt(testToken.account.data.parsed.info.amount);
    const decimals = testToken.account.data.parsed.info.tokenAmount.decimals;
    
    console.log(`\n▶ Testing SELL for ${mint.slice(0,20)}...`);
    console.log(`   Balance: ${balance} (${testToken.account.data.parsed.info.tokenAmount.uiAmountString})`);
    
    // Sell 10% of balance
    const sellAmount = Math.floor(balance * 0.1);
    console.log(`   Selling: ${sellAmount} raw units (10%)`);
    console.log();

    const result = await sellToken(mint, sellAmount, 2);
    
    if (result.success) {
      console.log(`✅ SELL SUCCESS!`);
      console.log(`   Received: ${result.solReceived.toFixed(6)} SOL`);
      console.log(`   TXID: ${result.txid?.slice(0,20)}...`);
    } else {
      console.log(`✖ SELL FAILED: ${result.error}`);
    }
  }
}

testSell().catch(console.error);