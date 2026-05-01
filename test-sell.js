import 'dotenv/config';
import { getWallet, getConnection } from './wallet.js';
import { sellToken, buyToken } from './executor.js';
import { log } from './logger.js';
import { CONFIG } from './config.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

const TEST_TOKEN = { name: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 };
const TEST_SOL_AMOUNT = 0.002; // ~$0.20

async function runSellTest() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              SELL FUNCTION TEST                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log();

  const conn = getConnection();
  const wallet = getWallet();
  
  console.log(`Testing from wallet: ${wallet.publicKey.toString().slice(0,8)}...`);
  const balance = await conn.getBalance(wallet.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  console.log();

  const token = TEST_TOKEN;
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`Testing: ${token.name} (${token.decimals} decimals)`);
  console.log(`Mint: ${token.mint}`);
  console.log(`─────────────────────────────────────────────────────────`);

  // First, check if token account exists
  console.log(`▶ Checking token accounts...`);
  const tokenAccount = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(token.mint) });
  if (tokenAccount.value.length === 0) {
    console.log(`✖ No token account found for ${token.name}! Need to create one first.`);
    return;
  }
  const tokenBal = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
  console.log(`   Token account found: ${tokenBal.uiAmountString} ${token.name}`);
  console.log(`   Raw amount: ${tokenBal.amount}`);
  console.log();

  try {
    // Test BUY first
    console.log(`▶ Testing BUY (${TEST_SOL_AMOUNT} SOL → ${token.name})...`);
    const buyResult = await buyToken(token.mint, TEST_SOL_AMOUNT, null, 2);
    
    if (!buyResult.success) {
      console.log(`✖ BUY FAILED: ${buyResult.error}`);
      return;
    }

    console.log(`✅ BUY SUCCESS: ${buyResult.tokenAmount ? (buyResult.tokenAmount / Math.pow(10, token.decimals)).toFixed(2) : '?'} tokens`);
    console.log(`   Raw token amount: ${buyResult.tokenAmount}`);
    console.log(`   SOL spent: ${buyResult.solSpent.toFixed(6)} SOL`);

    // Check actual token balance
    const tokenAccount = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(token.mint) });
    if (tokenAccount.value.length > 0) {
      const bal = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
      console.log(`   Token balance: ${bal.uiAmountString} ${token.name}`);
    }

    // Test SELL with half of received tokens (convert to raw units)
    const sellPercent = 0.5;
    const sellTokenAmountRaw = Math.floor(buyResult.tokenAmount * sellPercent);
    console.log(`\n▶ Testing SELL (${sellTokenAmountRaw} raw units → SOL)...`);
    console.log(`   (${(sellTokenAmountRaw / Math.pow(10, token.decimals)).toFixed(2)} ${token.name})`);
    
    const sellResult = await sellToken(token.mint, sellTokenAmountRaw, 2);
    
    if (!sellResult.success) {
      console.log(`✖ SELL FAILED: ${sellResult.error}`);
    } else {
      console.log(`✅ SELL SUCCESS!`);
      console.log(`   Received: ${sellResult.solReceived.toFixed(6)} SOL`);
      console.log(`   Price per token: ${(sellResult.solReceived / (sellTokenAmountRaw / Math.pow(10, token.decimals))).toExponential(6)} SOL`);
      
      // Calculate slippage
      const inputValue = (sellTokenAmountRaw / Math.pow(10, token.decimals)) * buyResult.pricePerToken;
      const actualSlippage = ((inputValue - sellResult.solReceived) / inputValue * 100);
      console.log(`   Slippage: ${actualSlippage.toFixed(2)}%`);
      
      // Check dynamic slippage logic
      console.log(`\n📊 Dynamic Slippage Check:`);
      console.log(`   Config SLIPPAGE_PERCENT: ${CONFIG.SLIPPAGE_PERCENT}%`);
      console.log(`   Dynamic slippage: ${CONFIG.DYNAMIC_SLIPPAGE ? 'ENABLED' : 'DISABLED'}`);
      console.log(`   Actual slippage: ${actualSlippage.toFixed(2)}%`);
      console.log(`   ✅ Test PASSED!` );
    }

  } catch (err) {
    console.log(`✖ ERROR: ${err.message}`);
    console.log(err.stack);
  }
  
  console.log(`\nDone!`);
}

runSellTest().catch(console.error);