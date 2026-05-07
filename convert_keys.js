import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

function convertToBase58(key, name) {
  if (!key) return null;
  try {
    // Try as base64 first
    const buffer = Buffer.from(key, 'base64');
    if (buffer.length === 64) {
      const b58 = bs58.encode(buffer);
      console.log(`${name} converted from Base64 to Base58`);
      return b58;
    }
  } catch (e) {}

  try {
    // Try as array
    const arr = JSON.parse(key);
    if (Array.isArray(arr) && arr.length === 64) {
      const b58 = bs58.encode(Uint8Array.from(arr));
      console.log(`${name} converted from Array to Base58`);
      return b58;
    }
  } catch (e) {}

  if (bs58.decode(key).length === 64) {
    console.log(`${name} is already Base58`);
    return key;
  }

  return key;
}

const envPath = '.env';
let envContent = fs.readFileSync(envPath, 'utf8');

const vaultKey = process.env.PRIVATE_KEY;
const signerKey = process.env.SIGNER_PRIVATE_KEY;

const newVault = convertToBase58(vaultKey, 'PRIVATE_KEY');
const newSigner = convertToBase58(signerKey, 'SIGNER_PRIVATE_KEY');

if (newVault && vaultKey !== newVault) {
  envContent = envContent.replace(vaultKey, newVault);
}
if (newSigner && signerKey !== newSigner) {
  envContent = envContent.replace(signerKey, newSigner);
}

fs.writeFileSync(envPath, envContent);
console.log('Updated .env with Base58 keys');
