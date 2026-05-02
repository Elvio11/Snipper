import { z } from 'zod';
import { MarketOrchestrator } from './orchestrator.js';

export const registerIntelligenceTools = (server: any) => {
  const orchestrator = new MarketOrchestrator();

  server.tool(
    'get_market_intelligence',
    'MAIP: Get unified market intelligence for a token (Market + Security + Social)',
    {
      address: z.string().describe('The token mint address'),
      chain: z.string().default('solana').describe('The chain (e.g. solana, eth)')
    },
    async ({ address, chain }: { address: string; chain: string }) => {
      try {
        const intelligence = await orchestrator.getIntelligence(address, chain);
        return {
          content: [{ type: 'text', text: JSON.stringify(intelligence, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error fetching intelligence: ${error.message}` }],
          isError: true
        };
      }
    }
  );
};
