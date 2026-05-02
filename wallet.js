import {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram
} from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { sendAlert } from './telegram.js';

let _connection = null;
let _vaultWallet = null;
let _signerWallet = null;
let _rpcIndex = 0;

// Paper trading simulated balances
let _paperSignerBalance = 0.017;
let _paperVaultBalance = 0.044;

const RPC_URLS = [
  CONFIG.RPC_URL,
  CONFIG.RPC_URL_FALLBACK,
].filter(url => !!url);

function getCurrentRPC() {
  if (RPC_URLS.length === 0) return CONFIG.RPC_URL;
  return RPC_URLS[_rpcIndex % RPC_URLS.length];
}

export function switchRPC() {
  if (RPC_URLS.length > 1) {
    _rpcIndex++;
    log('warn', `Switching to fallback RPC: ${getCurrentRPC()}`);
    _connection = null;
  }
}

export function getConnection() {
  if (!_connection) {
    const rpcUrl = getCurrentRPC();
    let wsUrl;

    if (rpcUrl.includes('helius-rpc.com')) {
      wsUrl = rpcUrl.replace('https://', 'wss://');
    } else {
      wsUrl = rpcUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://')
        .replace(/\?key=[^&]*/, '');
    }

    _connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30000,
      wsEndpoint: wsUrl,
    });
  }
  return _connection;
}

export async function withRetry(fn, maxRetries = 3, baseDelay = 500) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit = err.message?.includes('429') || err.code === 429;
      const isTimeout = err.message?.includes('timeout') || err.code === -32603;

      if (isRateLimit || isTimeout) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
        log('warn', `RPC error (attempt ${attempt + 1}/${maxRetries}): ${err.message}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));

        if (isRateLimit && attempt === maxRetries - 1) {
          switchRPC();
        }
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Decode a private key from either base58 or base64 format.
 * Tries base58 first (Phantom standard), falls back to base64 for legacy keys.
 */
function decodePrivateKey(keyString) {
  // Try base58 first (Phantom/Solana standard)
  try {
    const decoded = bs58.decode(keyString);
    if (decoded.length === 64) return decoded;
  } catch {}

  // Fallback: try base64 (legacy format from older generate-signer.js)
  try {
    const decoded = Buffer.from(keyString, 'base64');
    if (decoded.length === 64) {
      log('warn', 'Private key is base64-encoded. Consider re-exporting as base58 (Phantom standard).');
      return decoded;
    }
  } catch {}

  throw new Error('Invalid private key format. Expected base58 (Phantom) or base64.');
}

export function getVaultWallet() {
  if (!_vaultWallet) {
    if (CONFIG.PAPER_TRADING) {
      _vaultWallet = Keypair.generate();
    } else {
      const secret = decodePrivateKey(CONFIG.PRIVATE_KEY);
      _vaultWallet = Keypair.fromSecretKey(secret);
    }
    log('info', `Vault wallet: ${_vaultWallet.publicKey.toString().slice(0, 8)}...`);
  }
  return _vaultWallet;
}

export function getSignerWallet() {
  if (!_signerWallet) {
    if (CONFIG.PAPER_TRADING) {
      _signerWallet = Keypair.generate();
    } else if (CONFIG.SIGNER_PRIVATE_KEY) {
      const secret = decodePrivateKey(CONFIG.SIGNER_PRIVATE_KEY);
      _signerWallet = Keypair.fromSecretKey(secret);
    } else {
      _signerWallet = getVaultWallet();
    }
    log('info', `Signer wallet: ${_signerWallet.publicKey.toString().slice(0, 8)}...`);
  }
  return _signerWallet;
}

export function getWallet() {
  return getSignerWallet();
}

export async function getSOLBalance() {
  if (CONFIG.PAPER_TRADING) return _paperSignerBalance;
  try {
    const conn = getConnection();
    const bal = await conn.getBalance(getSignerWallet().publicKey);
    return bal / LAMPORTS_PER_SOL;
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      log('warn', 'Primary RPC key invalid/expired. Switching...');
      switchRPC();
      return getSOLBalance(); // Retry once
    }
    throw err;
  }
}

export async function getVaultBalance() {
  if (CONFIG.PAPER_TRADING) return _paperVaultBalance;
  try {
    const conn = getConnection();
    const bal = await conn.getBalance(getVaultWallet().publicKey);
    return bal / LAMPORTS_PER_SOL;
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      log('warn', 'Primary RPC key invalid/expired. Switching...');
      switchRPC();
      return getVaultBalance(); // Retry once
    }
    throw err;
  }
}

// Paper trading balance adjustments
export function paperDeductSigner(amount) {
  _paperSignerBalance = Math.max(0, _paperSignerBalance - amount);
}
export function paperCreditSigner(amount) {
  _paperSignerBalance += amount;
}
export function paperTransferToVault(amount) {
  _paperSignerBalance = Math.max(0, _paperSignerBalance - amount);
  _paperVaultBalance += amount;
}
export function paperRefillSigner(amount) {
  _paperVaultBalance = Math.max(0, _paperVaultBalance - amount);
  _paperSignerBalance += amount;
}

export async function refillSignerFromVault() {
  if (CONFIG.PAPER_TRADING) {
    const minSignerBal = CONFIG.SIGNER_MIN_BALANCE || 0.015;
    const refillAmount = CONFIG.SIGNER_REFILL_AMOUNT || 0.015;
    if (_paperSignerBalance >= minSignerBal) {
      return { success: true, reason: 'sufficient_balance' };
    }
    if (_paperVaultBalance < refillAmount) {
      return { success: false, reason: 'vault_low' };
    }
    paperRefillSigner(refillAmount);
    log('info', `[PAPER] Refilled signer: ${refillAmount} SOL (signer: ${_paperSignerBalance.toFixed(4)}, vault: ${_paperVaultBalance.toFixed(4)})`);
    return { success: true, reason: 'paper_refill' };
  }

  const signerBal = await getSOLBalance();
  const vaultBal = await getVaultBalance();
  const minSignerBal = CONFIG.SIGNER_MIN_BALANCE || 0.015;
  const refillAmount = CONFIG.SIGNER_REFILL_AMOUNT || 0.015;

  log('debug', `Refill check: signer=${signerBal.toFixed(6)}, vault=${vaultBal.toFixed(6)}, minSigner=${minSignerBal.toFixed(6)}, refill=${refillAmount.toFixed(6)}, combined=${(minSignerBal + refillAmount).toFixed(6)}`);

  if (signerBal >= minSignerBal) {
    return { success: true, reason: 'sufficient_balance' };
  }

  if (vaultBal <= minSignerBal + refillAmount) {
    const msg = `Vault balance too low for refill: ${vaultBal.toFixed(6)} <= ${(minSignerBal + refillAmount).toFixed(6)}`;
    log('warn', msg);
    return { success: false, reason: 'vault_low' };
  }

  try {
    const conn = getConnection();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: getVaultWallet().publicKey,
        toPubkey: getSignerWallet().publicKey,
        lamports: Math.floor(refillAmount * LAMPORTS_PER_SOL),
      })
    );

    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = getVaultWallet().publicKey;

    tx.sign(getVaultWallet());
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });

    log('info', `Refilled signer: ${refillAmount} SOL (tx: ${sig.slice(0, 8)}...)`);
    sendAlert('vault_refill', {
      amount: refillAmount,
      signerBalance: signerBal + refillAmount,
    });

    return { success: true, signature: sig };
  } catch (err) {
    log('error', `Refill failed: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

export async function getSolPrice() {
  // Primary: CoinGecko (free, no key needed)
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    const price = data?.solana?.usd;
    if (price && price > 0) return price;
  } catch (e) {
    log('debug', `CoinGecko SOL price fetch failed: ${e.message}`);
  }
  // Secondary: Jupiter Price API v3
  try {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data?.data?.[SOL_MINT]?.price || 90;
  } catch (e) {
    log('debug', `Jupiter SOL price fetch failed: ${e.message}`);
  }
  return 90;
}

export async function printWalletInfo() {
  const wallet  = getWallet();
  const balance = await getSOLBalance();
  const solPrice = await getSolPrice();
  log('info', `Wallet: ${wallet.publicKey.toString()}`);
  log('info', `Balance: ${balance.toFixed(4)} SOL (~$${(balance * solPrice).toFixed(2)} USD)`);
}
