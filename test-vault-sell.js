import 'dotenv/config';
import { getWallet, getConnection } from './wallet.js';
import { getVaultWalletAddress } from './wallet.js';
import { sellToken } from './executor.js';
import { PublicKey } from '@solana/web3.js';

async function testVaultSell() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              TEST SELL FROM VAULT                     ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log();

  const conn = getConnection();
  const vaultAddr = await getVaultWalletAddress();
  
  console.log(`Vault: ${vaultAddr.toString()}`);
  
  // Check SOL balance
  const solBalance = await conn.getBalance(vaultAddr);
  console.log(`Vault SOL Balance: ${(solBalance / 1e9).toFixed(6)} SOL`);
  console.log();

  // Get all token accounts for Vault
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(vaultAddr, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });

  console.log('Vault Token Accounts:');
  console.log('──────────────────────────────────────────────');
  
  const tokensWithBalance = [];
  for (const account of tokenAccounts.value) {
    const data = account.account.data.parsed.info;
    const balance = parseInt(data.amount);
    if (balance > 0) {
      tokensWithBalance.push({ mint: data.mint, balance, decimals: data.tokenAmount.decimals, uiAmount: data.tokenAmount.uiAmountString });
      console.log(`Mint: ${data.mint}`);
      console.log(`Balance: ${data.tokenAmount.uiAmountString}`);
      console.log(`Decimals: ${data.tokenAmount.decimals}`);
      console.log(`Raw: ${data.amount}`);
      console.log('──────────────────────────────────────────────');
    }
  }

  if (tokensWithBalance.length === 0) {
    console.log('No tokens with balance in Vault!');
    return;
  }

  // Test selling a small portion of first token
  const testToken = tokensWithBalance[0];
  console.log(`\n▶ Testing SELL for ${testToken.mint.slice(0,20)}...`);
  console.log(`   Balance: ${testToken.uiAmount}`);
  
  // Sell 5% of balance
  const sellAmount = Math.floor(testToken.balance * 0.05);
  console.log(`   Selling: ${sellAmount} raw units (5%)`);
  console.log();

  const result = await sellToken(testToken.mint, sellAmount, 2);
  
  if (result.success) {
    console.log(`✅ SELL SUCCESS!`);
    console.log(`   Received: ${result.solReceived.toFixed(6)} SOL`);
    console.log(`   TXID: ${result.txid?.slice(0,20)}...`);
  } else {
    console.log(`✖ SELL FAILED: ${result.error}`);
  }
}

testVaultSell().catch(console.error);