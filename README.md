# @agentdata/plugin-elizaos

**ElizaOS plugin** exposing the [AgentData API](https://agentdata-api.com) as agent actions. Real-time crypto market data for your ElizaOS agent via [x402](https://www.x402.org) micropayments on Base Mainnet.

[![ElizaOS](https://img.shields.io/badge/elizaOS-compatible-orange)](https://elizaos.github.io)
[![x402 v2](https://img.shields.io/badge/x402-v2-00D395)](https://www.x402.org)
[![Base Mainnet](https://img.shields.io/badge/network-Base%20Mainnet-0052FF)](https://basescan.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## What this plugin does

Adds 8 crypto market data **actions** and 1 passive **provider** to any ElizaOS agent. The agent can query live prices, funding rates, DeFi yields, arbitrage opportunities, technical indicators, and sentiment data — paying per request in USDC on Base Mainnet.

No API keys. No subscriptions. Just fund a wallet with USDC and your agent can access premium crypto data on demand.

## Install

```bash
npm install @agentdata/plugin-elizaos
```

## Usage

In your agent character file:

```typescript
import { agentdataPlugin } from '@agentdata/plugin-elizaos';

export const character = {
  name: 'CryptoTrader',
  // ... other config
  plugins: [agentdataPlugin],
  settings: {
    AGENTDATA_BUYER_PRIVATE_KEY: process.env.BUYER_WALLET_KEY, // 0x...
    AGENTDATA_BASE_URL: 'https://agentdata-api.com', // optional
  },
};
```

## Actions

These trigger when the user mentions relevant keywords:

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

## Provider

`agentdata_market_context` — passively injects current BTC/ETH prices and market sentiment into every agent turn. Gives your agent constant awareness of market state without explicit queries.

## Payment modes

**Without `AGENTDATA_BUYER_PRIVATE_KEY`** — actions throw "Payment required" with the 402 details. The agent will tell the user how much each query costs.

**With `AGENTDATA_BUYER_PRIVATE_KEY`** — plugin auto-signs ERC-3009 `TransferWithAuthorization` using viem. Each query costs $0.001–$0.003 USDC. Fund the buyer wallet with $5 → good for ~1500–5000 queries.

No ETH required on the buyer wallet — the AgentData facilitator pays settlement gas.

## Example agent conversation

```
User:  What are BTC and ETH doing right now?
Agent: [executes GET_CRYPTO_PRICES — $0.001 USDC]
       Bitcoin is at $68,718, Ethereum at $2,079.

User:  Is there arbitrage anywhere?
Agent: [executes GET_ARBITRAGE_OPPORTUNITIES — $0.003 USDC]
       Yes: SOL has a 0.12% spread between MEXC and Binance...
```

## Related

- **[agentdata-api](https://github.com/speteai/agentdata-api)** — the underlying x402 service
- **[agentdata-mcp](https://github.com/speteai/agentdata-mcp)** — MCP version for Claude Desktop
- **Live service:** https://agentdata-api.com

## Keywords

ElizaOS plugin, ai16z plugin, crypto data plugin, DeFi plugin, x402 plugin, AI agent crypto, agentic crypto trading, DeFAI agent, autonomous trading agent, ElizaOS actions, crypto market data plugin, agent economy

## License

MIT — see [LICENSE](LICENSE).
