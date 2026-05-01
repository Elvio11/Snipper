import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const keypair = Keypair.generate();

console.log('Generated new signer wallet:');
console.log('Public Key:', keypair.publicKey.toString());
// Use base58 encoding to match Phantom/Solana standard
console.log('Private Key (base58):', bs58.encode(keypair.secretKey));
console.log('\nAdd this to your .env as SIGNER_PRIVATE_KEY:');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8');
  const b58Key = bs58.encode(keypair.secretKey);
  if (env.match(/^SIGNER_PRIVATE_KEY=.*$/m)) {
    env = env.replace(/^SIGNER_PRIVATE_KEY=.*$/m, `SIGNER_PRIVATE_KEY=${b58Key}`);
  } else {
    env += `\nSIGNER_PRIVATE_KEY=${b58Key}\n`;
  }
  fs.writeFileSync(envPath, env);
  console.log('\n✓ Updated .env with signer key (base58)');
}

// Also create a test keyfile for backup
const keyfile = {
  pubkey: keypair.publicKey.toString(),
  secret: Array.from(keypair.secretKey)
};
fs.writeFileSync(path.join(__dirname, 'signer-keyfile.json'), JSON.stringify(keyfile, null, 2));
console.log('✓ Backup saved to scripts/signer-keyfile.json');
console.log('\n⚠️ IMPORTANT: Fund this wallet with ~0.2-0.5 SOL for trading');
console.log('   Your main wallet (VAULT) will auto-refill when needed');