/**
 * @agentdata/plugin-elizaos
 *
 * ElizaOS plugin exposing the AgentData API (https://agentdata-api.com) as
 * Actions and Providers. Supports both proxy mode (agent handles payment
 * externally) and auto-pay mode (plugin signs ERC-3009 authorizations using
 * the configured wallet).
 *
 * Configuration (in agent character file):
 *   settings:
 *     AGENTDATA_BASE_URL: https://agentdata-api.com
 *     AGENTDATA_BUYER_PRIVATE_KEY: 0x... (optional, enables auto-pay)
 */

const BASE_URL_DEFAULT = 'https://agentdata-api.com';
// The PAYMENT-REQUIRED header speaks x402 v2, where the field is `amount` and
// the network is CAIP-2. Only the 402 *body* still uses v1's
// `maxAmountRequired`. Reading the header and then asking for the v1 name
// yields undefined, and BigInt(undefined) throws — which meant this plugin
// could not complete a single payment in auto-pay mode. Resolve once.
const amountOf = (accept) => accept.amount ?? accept.maxAmountRequired;

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ============ AUTO-PAY CLIENT ============

async function buildFetcher(runtime) {
  const privateKey = runtime?.getSetting?.('AGENTDATA_BUYER_PRIVATE_KEY') || process.env.AGENTDATA_BUYER_PRIVATE_KEY;
  if (!privateKey) return fetch;

  try {
    const { createWalletClient, createPublicClient, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { base } = await import('viem/chains');

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: base, transport: http() });

    return async (url, options = {}) => {
      const r1 = await fetch(url, options);
      if (r1.status !== 402) return r1;

      const header = r1.headers.get('payment-required');
      if (!header) return r1;
      const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      const accept = payload.accepts[0];

      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + (accept.maxTimeoutSeconds || 300);
      const nonce = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');

      const signature = await walletClient.signTypedData({
        account,
        domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: account.address,
          to: accept.payTo,
          value: BigInt(amountOf(accept)),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      });

      const paymentPayload = {
        x402Version: 2, scheme: 'exact', network: accept.network,
        payload: { signature, authorization: {
          from: account.address, to: accept.payTo, value: amountOf(accept),
          validAfter: String(validAfter), validBefore: String(validBefore), nonce,
        }},
      };
      const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
      return fetch(url, {
        ...options,
        headers: { ...options.headers, 'PAYMENT-SIGNATURE': paymentHeader, 'X-PAYMENT': paymentHeader },
      });
    };
  } catch (e) {
    console.error('[agentdata] Auto-pay disabled:', e.message);
    return fetch;
  }
}

async function callEndpoint(runtime, path, params = {}) {
  const baseUrl = runtime?.getSetting?.('AGENTDATA_BASE_URL') || process.env.AGENTDATA_BASE_URL || BASE_URL_DEFAULT;
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const fetcher = await buildFetcher(runtime);
  const res = await fetcher(url.toString());
  if (res.status === 402) {
    const header = res.headers.get('payment-required');
    let info = {};
    if (header) { try { info = JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch {} }
    throw new Error(`Payment required. Set AGENTDATA_BUYER_PRIVATE_KEY to enable auto-pay. Accept: ${JSON.stringify(info.accepts?.[0] || {})}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ============ ACTIONS ============

const actions = [
  // Listed first deliberately: these are the capabilities an agent cannot build
  // for itself. It exists only while it runs, so it cannot wait, remember, or
  // compare against its own last look. And a wired-up agent never re-reads the
  // catalogue — whatever it will buy, it learns here, at integration time.
  {
    name: 'GET_CHANGES_SINCE_LAST_CALL',
    similes: ['what changed', 'since last time', 'new data', 'delta', 'diff', 'updates'],
    description: 'Fetch only what changed for a signal since this wallet last paid for it. Costs $0.001 USDC — cheaper than any full payload, and the server keeps the cursor so nothing is re-downloaded.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const signal = options?.signal || 'sentiment';
      const data = await callEndpoint(runtime, `/api/diff?signal=${encodeURIComponent(signal)}`);
      const d = data.data || data;
      const text = d.firstCall
        ? `First look at ${signal}: ${d.newPoints} points from the last 24h.`
        : `${d.newPoints} new ${signal} point(s) since your last paid call (${d.since}).`;
      if (callback) callback({ text });
      return text;
    },
    examples: [[
      { user: 'user', content: { text: 'What changed in sentiment since I last checked?' }},
      { user: 'agent', content: { text: 'Fetching only the new points.', action: 'GET_CHANGES_SINCE_LAST_CALL' }},
    ]],
  },

  {
    name: 'WATCH_CONDITION',
    similes: ['alert me', 'notify when', 'watch for', 'tell me when', 'standing order'],
    description: 'Register a standing condition on a signal and let the always-on server watch it. Costs $0.010 USDC for up to 168h. Poll the status free instead of paying for repeated data calls.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const { signal = 'sentiment', op = 'above', threshold, subject, hours = 24 } = options || {};
      if (threshold === undefined) throw new Error('threshold is required');
      const q = new URLSearchParams({ signal, op, threshold: String(threshold), hours: String(hours) });
      if (subject) q.set('subject', subject);
      const data = await callEndpoint(runtime, `/api/watch?${q}`);
      const d = data.data || data;
      const text = `Watching ${signal} ${op} ${threshold} until ${d.expiresAt}. Note: it reports a CHANGE, so a condition already true fires on the next observation, not instantly.`;
      if (callback) callback({ text });
      return text;
    },
    examples: [[
      { user: 'user', content: { text: 'Tell me when sentiment goes above 70.' }},
      { user: 'agent', content: { text: 'Registering a watch on the server.', action: 'WATCH_CONDITION' }},
    ]],
  },

  {
    name: 'GET_SIGNAL_CALIBRATION',
    similes: ['how accurate', 'track record', 'hit rate', 'is this reliable', 'calibration'],
    description: 'FREE. How often these signals actually turned out right, scored against a naive baseline. Claims are recorded before the outcome exists. Worth reading before trusting any signal — including to see which ones do not yet justify their price.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const days = options?.days || 30;
      const data = await callEndpoint(runtime, `/calibration?days=${days}`);
      const rows = (data.signals || []).map(x =>
        `• ${x.signal}/${x.claim}: ${x.hitRate === null ? 'n/a' : (x.hitRate * 100).toFixed(1) + '%'} over ${x.resolved} resolved${x.beatsNaive === null ? '' : (x.beatsNaive ? ' (beats naive)' : ' (does NOT beat naive)')}`);
      const text = rows.length ? `Signal track record:\n${rows.join('\n')}` : 'No resolved claims in this window yet.';
      if (callback) callback({ text });
      return text;
    },
    examples: [[
      { user: 'user', content: { text: 'How reliable are these signals?' }},
      { user: 'agent', content: { text: 'Reading the published track record.', action: 'GET_SIGNAL_CALIBRATION' }},
    ]],
  },

  {
    name: 'GET_CRYPTO_PRICES',
    similes: ['crypto prices', 'bitcoin price', 'ethereum price', 'btc', 'eth price', 'current prices', 'market prices'],
    description: 'Get real-time prices for BTC, ETH, SOL, BNB, XRP. Costs $0.002 USDC via x402.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/prices');
      const text = `Current crypto prices:\n${Object.entries(data.data).map(([sym, v]) => `• ${sym}: $${v.price}`).join('\n')}`;
      if (callback) callback({ text });
      return text;
    },
    examples: [[
      { user: 'user', content: { text: 'What are the current crypto prices?' }},
      { user: 'agent', content: { text: 'Let me check the current prices.', action: 'GET_CRYPTO_PRICES' }},
    ]],
  },

  {
    name: 'GET_FUNDING_RATES',
    similes: ['funding rate', 'perpetuals', 'perp funding', 'longs vs shorts'],
    description: 'Get perpetual futures funding rates with long/short bias signals. Costs $0.002 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/funding-rates');
      const lines = Object.entries(data.data).map(([s, v]) =>
        `• ${s}: ${(v.rate * 100).toFixed(4)}% (${v.annualized} annualized, ${v.signal})`
      );
      const text = `Funding rates:\n${lines.join('\n')}`;
      if (callback) callback({ text });
      return text;
    },
  },

  {
    name: 'GET_MARKET_OVERVIEW',
    similes: ['market overview', 'market sentiment', 'market state', 'how is the market'],
    description: 'Full market overview with sentiment bias and arbitrage signals. Costs $0.002 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/market-overview');
      const s = data.data.signals;
      const text = `Market Overview:\n• Bias: ${s.bias}\n• BTC: $${data.data.prices.BTCUSDT?.price}\n• ETH: $${data.data.prices.ETHUSDT?.price}\n• Arb opportunity: ${s.arbOpportunity ? 'YES' : 'no'}\n• Funding yield (annualized): ${s.fundingYieldAnnual}`;
      if (callback) callback({ text });
      return text;
    },
  },

  {
    name: 'GET_DEFI_YIELDS',
    similes: ['defi yields', 'yield farming', 'best yields', 'usdc yield', 'stablecoin yield'],
    description: 'Top DeFi yield opportunities from Aave, Compound, Morpho, Pendle. Costs $0.002 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/defi-yields');
      const top5 = (data.data.topStablecoinYields || []).slice(0, 5);
      const lines = top5.map(p => `• ${p.project} (${p.chain}): ${p.apy}% APY on ${p.symbol} (TVL: $${(p.tvlUsd/1e6).toFixed(1)}M)`);
      const text = `Top 5 Stablecoin Yields:\n${lines.join('\n')}`;
      if (callback) callback({ text });
      return text;
    },
  },

  {
    name: 'GET_ARBITRAGE_OPPORTUNITIES',
    similes: ['arbitrage', 'arb', 'cross exchange spread', 'price difference'],
    description: 'Cross-exchange arbitrage opportunities (MEXC/Binance/Bybit/OKX). Costs $0.003 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/arbitrage-opportunities');
      const opps = (data.data.opportunities || []).slice(0, 5);
      if (!opps.length) return 'No significant arbitrage opportunities right now.';
      const lines = opps.map(o => `• ${o.symbol}: buy on ${o.buyOn} @ $${o.buyPrice}, sell on ${o.sellOn} @ $${o.sellPrice} (${o.spreadPct}% spread${o.profitableAfterFees ? ' ✅ profitable' : ''})`);
      const text = `Arbitrage Opportunities:\n${lines.join('\n')}`;
      if (callback) callback({ text });
      return text;
    },
  },

  {
    name: 'GET_TECHNICAL_INDICATORS',
    similes: ['rsi', 'macd', 'bollinger', 'technical indicators', 'ta'],
    description: 'Get RSI, MACD, Bollinger Bands, ATR for a symbol. Costs $0.002 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const symbol = options?.symbol || state?.symbol || 'BTCUSDT';
      const interval = options?.interval || '1h';
      const data = await callEndpoint(runtime, '/api/indicators', { symbol, interval });
      const i = data.data.indicators;
      const text = `${symbol} ${interval} indicators:\n• RSI: ${i.rsi.value} (${i.rsi.signal})\n• MACD: ${i.macd.trend}\n• Bollinger: ${i.bollinger.signal} (${i.bollinger.positionPct}% of range)\n• ATR: ${i.atr.volatilityPct}`;
      if (callback) callback({ text });
      return text;
    },
  },

  {
    name: 'GET_SENTIMENT',
    similes: ['fear and greed', 'sentiment', 'market mood'],
    description: 'Composite market sentiment: Fear & Greed Index + Funding-based. Costs $0.002 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/sentiment');
      const text = `Market Sentiment:\n• Fear & Greed: ${data.data.fearGreedIndex.value} (${data.data.fearGreedIndex.classification})\n• Funding-based: ${data.data.fundingBasedSentiment}\n• Composite: ${data.data.compositeSentiment.value} (${data.data.compositeSentiment.classification})`;
      if (callback) callback({ text });
      return text;
    },
  },

  {
    name: 'GET_STABLECOIN_HEALTH',
    similes: ['usdc peg', 'dai peg', 'depeg', 'stablecoin status'],
    description: 'USDC/DAI peg monitoring + top 10 stablecoins. Costs $0.002 USDC.',
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      const data = await callEndpoint(runtime, '/api/stablecoin-health');
      const peg = data.data.liveDepegCheck;
      const text = `Stablecoin Health:\n• USDC: $${peg.USDC.price} (${peg.USDC.pegDeviation} off peg, ${peg.USDC.status})\n• DAI: $${peg.DAI.price} (${peg.DAI.pegDeviation} off peg, ${peg.DAI.status})\n• Total stablecoin market cap: $${(data.data.totalStablecoinMarketCap/1e9).toFixed(1)}B`;
      if (callback) callback({ text });
      return text;
    },
  },
];

// ============ PROVIDERS (passive context injection) ============

const providers = [
  {
    name: 'agentdata_market_context',
    description: 'Provides current crypto market context for every agent turn',
    get: async (runtime, message) => {
      try {
        const data = await callEndpoint(runtime, '/api/market-overview');
        return `[Market context] BTC: $${data.data.prices.BTCUSDT?.price}, ETH: $${data.data.prices.ETHUSDT?.price}, Sentiment: ${data.data.signals.bias}`;
      } catch { return ''; }
    },
  },
];

// ============ PLUGIN EXPORT ============

export const agentdataPlugin = {
  name: '@agentdata/plugin-elizaos',
  description: 'Real-time crypto market data for AI agents via x402 micropayments on Base',
  actions,
  providers,
  services: [],
  evaluators: [],
};

export default agentdataPlugin;
