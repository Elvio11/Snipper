require('dotenv').config();
const { Connection, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { jupiterApi } = require('./src/jupiter-client.js');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const wallet = new PublicKey('4r7AGbRy8hVp8L21XsEydgQkUBcGeoCZn5jkcAVUY2RX');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

async function getATA(mint, owner) {
  const [ata] = await PublicKey.findProgramAddress(
    [mint.toBuffer(), owner.toBuffer()],
    ATA_PROGRAM
  );
  return ata;
}

async function main() {
  console.log('SOL_MINT from executor:', SOL_MINT, 'length:', SOL_MINT.length);

  const quote = await jupiterApi.quoteGet({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: 1000000,
    slippageBps: 1000,
  });
  console.log('Quote OK:', quote.outAmount);

  const destATA = await getATA(new PublicKey(USDC_MINT), wallet);
  console.log('Destination ATA:', destATA.toString());

  const swap = await jupiterApi.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey: wallet.toString(),
      destinationTokenAccount: destATA.toString(),
    }
  });
  console.log('Swap OK, tx length:', swap.swapTransaction.length);

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
  console.log('\\nTransaction accounts:');
  tx.transaction.message.staticAccountKeys.slice(0, 8).forEach((k, i) => {
    const isWallet = k.toString() === wallet.toString();
    const isATA = k.toString() === destATA.toString();
    console.log(i, k.toString().slice(0, 35), isWallet ? '<- WALLET' : isATA ? '<- ATA' : '');
  });
}

main().catch(e => console.log('Error:', e.message));