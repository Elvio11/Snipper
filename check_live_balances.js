import { getConnection, getVaultWallet, getSignerWallet } from './wallet.js';
import { CONFIG } from './config.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

async function checkRealBalances() {
  // Force PAPER_TRADING to false to get real wallets and balances
  const originalMode = CONFIG.PAPER_TRADING;
  CONFIG.PAPER_TRADING = false;

  try {
    const connection = getConnection();
    
    const vault = getVaultWallet();
    const signer = getSignerWallet();

    const vBal = await connection.getBalance(vault.publicKey);
    const sBal = await connection.getBalance(signer.publicKey);

    console.log('\n--- REAL ON-CHAIN BALANCES (LIVE) ---');
    console.log(`SIGNER: ${signer.publicKey.toBase58()}`);
    console.log(`        Balance: ${(sBal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`VAULT : ${vault.publicKey.toBase58()}`);
    console.log(`        Balance: ${(vBal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log('-------------------------------------\n');

  } catch (err) {
    console.error('Error checking live balances:', err.message);
    if (err.message.includes('64')) {
        console.log('TIP: Check if your private keys in .env are exactly 64 bytes when decoded.');
    }
  } finally {
    CONFIG.PAPER_TRADING = originalMode;
  }
}

checkRealBalances();
