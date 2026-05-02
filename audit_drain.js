import { getConnection, getVaultWallet, getSignerWallet } from './wallet.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

async function auditDrain() {
  const conn = getConnection();
  const vault = getVaultWallet();
  const signer = getSignerWallet();

  console.log('\n--- DRAIN AUDIT REPORT ---');

  const wallets = [
    { name: 'VAULT', pubkey: vault.publicKey },
    { name: 'SIGNER', pubkey: signer.publicKey }
  ];

  for (const w of wallets) {
    console.log(`\nAnalyzing ${w.name}: ${w.pubkey.toBase58()}`);
    try {
      const signatures = await conn.getSignaturesForAddress(w.pubkey, { limit: 10 });
      let totalFeePaid = 0;
      let totalTransferred = 0;

      for (const sig of signatures) {
        const tx = await conn.getTransaction(sig.signature, { 
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });

        if (tx) {
          const fee = tx.meta.fee / LAMPORTS_PER_SOL;
          totalFeePaid += fee;
          
          // Check for significant SOL transfers out (pre vs post balances)
          const preBal = tx.meta.preBalances[0] / LAMPORTS_PER_SOL;
          const postBal = tx.meta.postBalances[0] / LAMPORTS_PER_SOL;
          const delta = preBal - postBal - fee;
          
          if (delta > 0.0001) {
            totalTransferred += delta;
            console.log(`   - ${new Date(sig.blockTime * 1000).toLocaleString()} | OUT: ${delta.toFixed(6)} SOL | Fee: ${fee.toFixed(6)} | ${sig.signature.slice(0, 10)}...`);
          } else {
            console.log(`   - ${new Date(sig.blockTime * 1000).toLocaleString()} | FAILED/EMPTY | Fee: ${fee.toFixed(6)} | ${sig.signature.slice(0, 10)}...`);
          }
        }
      }
      console.log(`\n   Summary for ${w.name}:`);
      console.log(`   - Total Fees Paid: ${totalFeePaid.toFixed(6)} SOL`);
      console.log(`   - Total SOL Out: ${totalTransferred.toFixed(6)} SOL`);
    } catch (err) {
      console.error(`   Error auditing ${w.name}:`, err.message);
    }
  }
  console.log('\n--------------------------');
  process.exit(0);
}

auditDrain();
