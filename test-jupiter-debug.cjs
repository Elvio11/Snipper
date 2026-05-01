require('dotenv').config();
const { Connection, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { jupiterApi } = require('./src/jupiter-client.js');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const wallet = new PublicKey('4r7AGbRy8hVp8L21XsEydgQkUBcGeoCZn5jkcAVUY2RX');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

async function getATA(mint, owner) {
  const [ata] = await PublicKey.findProgramAddress([mint.toBuffer(), owner.toBuffer()], ATA_PROGRAM);
  return ata;
}

async function main() {
  const quote = await jupiterApi.quoteGet({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: 1000000,
    slippageBps: 1000,
  });

  const destATA = await getATA(new PublicKey(USDC_MINT), wallet);
  console.log('Destination ATA:', destATA.toString());

  const swap = await jupiterApi.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey: wallet.toString(),
      destinationTokenAccount: destATA.toString(),
    }
  });

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
  
  console.log('\\n=== Accounts in Transaction ===');
  const msg = tx.message;
  console.log('Static keys count:', msg.staticAccountKeys?.length);
  
  msg.staticAccountKeys.forEach((k, i) => {
    const isWallet = k.toString() === wallet.toString();
    const isATA = k.toString() === destATA.toString();
    console.log(i, k.toString(), isWallet ? '<- WALLET' : isATA ? '<- ATA' : '');
  });
}

main().catch(e => console.log('Error:', e.message));