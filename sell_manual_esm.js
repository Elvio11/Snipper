import dotenv from 'dotenv';
dotenv.config();
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';
import { getSignerWallet } from './wallet.js';

const mintAddress = '3QQQxazHaMb72d7N9iftT26vuk6A4Re31fYmkwA2pump';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const amountRaw = 1344958830;

async function run() {
    const wallet = getSignerWallet();
    console.log("Wallet:", wallet.publicKey.toString());
    
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl);

    console.log(`Getting quote for selling ${amountRaw} lamports of ${mintAddress}...`);
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${mintAddress}&outputMint=${SOL_MINT}&amount=${amountRaw}&slippageBps=3000`;
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
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 5000000
        })
    });
    
    const swapData = await swapRes.json();
    if (swapData.error) {
        console.error("Swap error:", swapData.error);
        return;
    }
    
    if (!swapData.swapTransaction) {
        console.error("No swapTransaction in response:", swapData);
        return;
    }

    console.log("Signing and sending transaction...");
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const latestBlockHash = await conn.getLatestBlockhash();
    const rawTransaction = transaction.serialize();
    
    const txid = await conn.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 0
    });
    console.log("Transaction ID:", txid);
    console.log("Broadcasting and waiting for confirmation...");
    
    let confirmed = false;
    const interval = setInterval(() => {
        if (!confirmed) {
            conn.sendRawTransaction(rawTransaction, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
        }
    }, 1000);
    
    try {
        await conn.confirmTransaction({
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: txid
        }, 'confirmed');
        confirmed = true;
        console.log("Confirmed! https://solscan.io/tx/" + txid);
    } catch(e) {
        console.log("Confirmation failed or expired:", e.message);
    } finally {
        clearInterval(interval);
    }
}

run().catch(console.error);
