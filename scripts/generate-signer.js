import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const keypair = Keypair.generate();

console.log('Generated new signer wallet:');
console.log('Public Key:', keypair.publicKey.toString());
console.log('Private Key (base58):', Buffer.from(keypair.secretKey).toString('base64'));
console.log('\nAdd this to your .env as SIGNER_PRIVATE_KEY:');

const envPath = path.join(__dirname, '.env');
let env = fs.readFileSync(envPath, 'utf8');
env = env.replace(/^SIGNER_PRIVATE_KEY=.*$/m, `SIGNER_PRIVATE_KEY=${Buffer.from(keypair.secretKey).toString('base64')}`);
fs.writeFileSync(envPath, env);
console.log('\n✓ Updated .env with signer key');

// Also create a test keyfile for backup
const keyfile = {
  pubkey: keypair.publicKey.toString(),
  secret: Array.from(keypair.secretKey)
};
fs.writeFileSync(path.join(__dirname, 'signer-keyfile.json'), JSON.stringify(keyfile, null, 2));
console.log('✓ Backup saved to signer-keyfile.json');
console.log('\n⚠️ IMPORTANT: Fund this wallet with ~0.2-0.5 SOL for trading');
console.log('   Your main wallet (VAULT) will auto-refill when needed');