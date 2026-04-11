# @agentdata/plugin-elizaos

ElizaOS plugin exposing the [AgentData API](https://agentdata-api.com) as agent actions. Provides 8 crypto market data actions (prices, funding, DeFi yields, arbitrage, indicators, sentiment, etc.) backed by x402 micropayments on Base Mainnet.

## Install

```bash
npm install @agentdata/plugin-elizaos
```

## Usage

In your ElizaOS agent character file:

```typescript
import { agentdataPlugin } from '@agentdata/plugin-elizaos';

export const character = {
  // ...
  plugins: [agentdataPlugin],
  settings: {
    AGENTDATA_BUYER_PRIVATE_KEY: '0x...',  // optional: enables auto-pay
    AGENTDATA_BASE_URL: 'https://agentdata-api.com',  // optional override
  },
};
```

## Actions

| Action | Price | Trigger phrases |
|--------|-------|----------------|
| `GET_CRYPTO_PRICES` | $0.001 | "crypto prices", "bitcoin price", "eth price" |
| `GET_FUNDING_RATES` | $0.001 | "funding rate", "perpetuals" |
| `GET_MARKET_OVERVIEW` | $0.002 | "market overview", "market sentiment" |
| `GET_DEFI_YIELDS` | $0.002 | "defi yields", "best yield" |
| `GET_ARBITRAGE_OPPORTUNITIES` | $0.003 | "arbitrage", "price difference" |
| `GET_TECHNICAL_INDICATORS` | $0.002 | "rsi", "macd", "ta" |
| `GET_SENTIMENT` | $0.001 | "fear and greed", "sentiment" |
| `GET_STABLECOIN_HEALTH` | $0.001 | "usdc peg", "depeg" |

## Providers

The plugin also registers `agentdata_market_context` which injects current BTC/ETH prices and sentiment into every agent turn, giving your agent passive awareness of market state without needing explicit queries.

## Payment Modes

**Without `AGENTDATA_BUYER_PRIVATE_KEY`:** Actions throw "Payment required" errors — the agent tells the user how much a query costs.

**With `AGENTDATA_BUYER_PRIVATE_KEY`:** Plugin signs ERC-3009 authorizations automatically using viem. Fund the buyer wallet with USDC on Base Mainnet (~$1 buys 1000 requests).

No ETH needed on the buyer wallet — the facilitator pays settlement gas.

## License

MIT
