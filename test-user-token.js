
import { Connection } from '@solana/web3.js';
import { analyzeToken } from './safety.js';
import { dexService } from './src/services/dexscreener-service.js';
import { log } from './logger.js';
import dotenv from 'dotenv';
dotenv.config();

const mint = 'iBcavzgHdvaHHEM6Tdm9UsRqEJu2iQRac3cjinbpump';

async function test() {
    log('info', `\n🔍 Targeted Audit: ${mint}`);
    log('info', '--------------------------------------------------');

    try {
        log('info', '[AUDIT] Fetching market data from DexScreener...');
        const result = await dexService.getTokenPairs(mint);
        
        let poolInfo = null;
        if (result.success && result.data?.length > 0) {
            const pair = result.data[0];
            poolInfo = {
                baseMint: mint,
                quoteMint: pair.quoteToken?.address || 'So11111111111111111111111111111111111111112',
                dex: pair.dexId,
                liquidityUSD: pair.liquidity?.usd || 0
            };
            log('info', `[AUDIT] Found pair on ${pair.dexId} with $${poolInfo.liquidityUSD.toFixed(0)} liquidity`);
        } else {
            log('warn', '[AUDIT] No public pair found on DexScreener (token may be too new)');
            poolInfo = { baseMint: mint, dex: 'pumpfun' };
        }

        log('info', '[AUDIT] Running security analysis pipeline...');
        const safety = await analyzeToken(mint, poolInfo);
        
        log('info', '\n📊 Analysis Result:');
        log('info', `Safe: ${safety.safe ? '✅ YES' : '❌ NO'}`);
        log('info', `Score: ${safety.score}/100`);
        
        if (safety.reasons.length > 0) {
            log('info', '\n📝 Reasons:');
            safety.reasons.forEach(r => log('info', `  - ${r}`));
        }

        if (safety.safe) {
            log('success', '\n🚀 PASS: Token meets all safety and liquidity thresholds.');
            log('success', '   You can now run "npm start" to trade tokens like this automatically.');
        } else {
            log('warn', '\n⚠️ FAIL: Token rejected by safety filters.');
        }

    } catch (error) {
        log('error', `❌ Audit failed: ${error.message}`);
    }
}

test();
