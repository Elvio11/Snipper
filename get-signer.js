import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import bip39 from 'bip39';
import bs58 from 'bs58';
import 'dotenv/config';

// Read mnemonic from environment - NEVER hardcode
const mnemonic = process.env.SIGNER_MNEMONIC;

if (!mnemonic) {
  console.error('ERROR: SIGNER_MNEMONIC not set in .env');
  console.log('Generate a new signer wallet with: node scripts/generate-signer.js');
  process.exit(1);
}

const seed = bip39.mnemonicToSeedSync(mnemonic, '');

// Account 0 for signer
const path = "m/44'/501'/0'/0'";
const { key } = derivePath(path, seed);
const keypair = Keypair.fromSeed(key);
console.log('Signer Address:', keypair.publicKey.toString());
// Output base58 to match Phantom format and wallet.js decoding
console.log('Signer Private Key (base58):', bs58.encode(keypair.secretKey));
console.log('\nSet SIGNER_PRIVATE_KEY in .env to the base58 string above.');