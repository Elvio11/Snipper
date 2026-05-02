require('dotenv').config();
const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');
const bs58 = require('bs58').default; // Using .default in case of export mismatch, but usually it's just require('bs58')

const mintAddress = '4nswj3o1Lo9iWYvvRJxUD8vbCy9ay7QQoXYcncHNbonk';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const amountRaw = 2803129320; // 2803.129320 * 10^6

async function run() {
    let key;
    if (process.env.PRIVATE_KEY.includes('[')) {
        // Assume byte array
        key = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
    } else if (process.env.PRIVATE_KEY.length > 80) {
        // Probably base58
        const bs58Lib = bs58 || require('bs58');
        key = bs58Lib.decode(process.env.PRIVATE_KEY);
    } else {
        // Base64
        key = Buffer.from(process.env.PRIVATE_KEY, 'base64');
    }
    
    const wallet = Keypair.fromSecretKey(key);
    console.log("Wallet:", wallet.publicKey.toString());
    
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl);

    console.log(`Getting quote for selling ${amountRaw} lamports of ${mintAddress}...`);
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${mintAddress}&outputMint=${SOL_MINT}&amount=${amountRaw}&slippageBps=300`;
    console.log("GET", quoteUrl);
    
    const quoteRes = await fetch(quoteUrl);
    const quoteData = await quoteRes.json();
    
    if (quoteData.error) {
        console.error("Quote error:", quoteData.error);
        return;
    }
    console.log("Expected output (SOL lamports):", quoteData.outAmount);

    console.log("Requesting swap transaction...");
    const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            prioritizationFeeLamports: "auto"
        })
    });
    
    const swapData = await swapRes.json();
    if (swapData.error) {
        console.error("Swap error:", swapData.error);
        return;
    }

    console.log("Signing and sending transaction...");
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const latestBlockHash = await conn.getLatestBlockhash();
    const rawTransaction = transaction.serialize()
    const txid = await conn.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
    });
    console.log("Transaction ID:", txid);
    console.log("Waiting for confirmation...");
    await conn.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: txid
    });
    console.log("Confirmed! https://solscan.io/tx/" + txid);
}

run().catch(console.error);
