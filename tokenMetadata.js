import { getConnection } from './wallet.js';
import { PublicKey } from '@solana/web3.js';
import { log } from './logger.js';

const TOKEN_METADATA_CACHE = new Map();

export async function getTokenMetadata(mintAddress) {
  if (TOKEN_METADATA_CACHE.has(mintAddress)) {
    return TOKEN_METADATA_CACHE.get(mintAddress);
  }

  try {
    const conn = getConnection();
    const mintPubkey = new PublicKey(mintAddress);
    
    const metadataProgram = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6XWeKBF5VN');
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        metadataProgram.toBytes(),
        mintPubkey.toBytes(),
      ],
      metadataProgram
    );

    const metadataInfo = await conn.getParsedAccountInfo(metadataPDA, 'finalized');
    
    if (metadataInfo.value?.data) {
      const data = metadataInfo.value.data;
      const result = {
        name: data.parsed?.info?.data?.name || null,
        symbol: data.parsed?.info?.data?.symbol || null,
        uri: data.parsed?.info?.data?.uri || null,
      };
      
      if (result.name || result.symbol) {
        TOKEN_METADATA_CACHE.set(mintAddress, result);
        return result;
      }
    }
  } catch (err) {
    log('debug', `No metadata for ${mintAddress.slice(0,8)}: ${err.message}`);
  }

  return { name: null, symbol: null, uri: null };
}

export function getTokenName(mintAddress, metadata) {
  if (metadata?.symbol) {
    return metadata.symbol;
  }
  if (metadata?.name) {
    return metadata.name.length > 20 
      ? metadata.name.slice(0, 17) + '...' 
      : metadata.name;
  }
  return mintAddress.slice(0, 8) + '...';
}