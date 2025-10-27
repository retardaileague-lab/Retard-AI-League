

import dotenv from 'dotenv';
dotenv.config({ path: './config.env' }); 


const FOUR_MEME_BONDING_URL =
  'https://four.meme/meme-api/v1/private/token/query?orderBy=BnTimeDesc&queryMode=Binance&tokenName=&listedPancake=true&pageIndex=1&pageSize=30&symbol=BNB&labels=';

const FOUR_MEME_GRADUATED_URL =
  'https://four.meme/meme-api/v1/private/token/query?orderBy=Hot&tokenName=&listedPancake=false&pageIndex=1&pageSize=30&symbol=&labels=';

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
if (!MORALIS_API_KEY) {
  console.error('❌ MORALIS_API_KEY отсутствует. Добавь его в config.env');
  process.exit(1);
}

const MORALIS_BASE = 'https://deep-index.moralis.io/api/v2.2';
async function withRetry(fn, {
  retries = 3,         
  baseDelayMs = 400,   
  factor = 2,          
  jitterMs = 150       
} = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      attempt += 1;
      if (attempt >= retries) break;
      const delay = baseDelayMs * (factor ** (attempt - 1)) + Math.random() * jitterMs;
      await sleep(delay);
    }
  }
  throw lastErr;
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toNumberOrNull(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function formatPct(num, fractionDigits = 4) {
  if (num === null || num === undefined) return null;
  return `${num.toFixed(fractionDigits)}%`;
}

function pickStatsFromAnalytics(analytics) {
  if (!analytics || typeof analytics !== 'object') return null;
  const {
    totalBuyVolume,
    totalSellVolume,
    totalBuyers,
    totalSellers,
    totalBuys,
    totalSells,
    uniqueWallets,
    pricePercentChange,
  } = analytics;

  return {
    totalBuyVolume,
    totalSellVolume,
    totalBuyers,
    totalSellers,
    totalBuys,
    totalSells,
    uniqueWallets,
    pricePercentChange,
  };
}

function pickStatsFromTokenPrice(token) {
  const tp = token?.tokenPrice || {};
  return {
    tradingUsd: toNumberOrNull(tp.tradingUsd),
    trading: toNumberOrNull(tp.trading),
    dayTrading: toNumberOrNull(tp.dayTrading),
  };
}


async function fetchFourMemeTokens(url) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Four.meme HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.code !== 0 || !Array.isArray(json.data)) {
      throw new Error('Некорректный ответ four.meme');
    }
    return json.data;
  }, { retries: 4, baseDelayMs: 500 }); 
}


async function fetchOwners(address) {
  return withRetry(async () => {
    const url = `${MORALIS_BASE}/erc20/${address}/owners?chain=bsc&limit=16&order=DESC`;
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': MORALIS_API_KEY,
      },
    });
    if (!res.ok) throw new Error(`Moralis owners HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (!Array.isArray(json.result)) return [];
    return json.result;
  }, { retries: 3, baseDelayMs: 600 });
}

async function fetchAnalytics(address) {
  return withRetry(async () => {
    const url = `${MORALIS_BASE}/tokens/${address}/analytics?chain=bsc`;
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': MORALIS_API_KEY,
      },
    });
    if (!res.ok) throw new Error(`Moralis analytics HTTP ${res.status} ${res.statusText}`);
    return res.json();
  }, { retries: 3, baseDelayMs: 600 });
}


function buildHolders(owners) {
  const humans = owners
    .filter((o) => o && o.is_contract === false && o.percentage_relative_to_total_supply != null)
    .sort((a, b) => b.percentage_relative_to_total_supply - a.percentage_relative_to_total_supply);

  const holders = {};
  let rank = 1;
  for (const o of humans) {
    holders[String(rank)] = formatPct(Number(o.percentage_relative_to_total_supply));
    rank += 1;
  }
  return holders;
}


async function buildBondingEntry(token) {
  const address = token.address;
  const name = token.name;
  const marketCapUSD = toNumberOrNull(token?.tokenPrice?.marketCap);

  const owners = await fetchOwners(address);
  const holders = buildHolders(owners);

  const analytics = await fetchAnalytics(address);
  const stats = pickStatsFromAnalytics(analytics);

  return { address, name, marketCapUSD, holders, stats };
}


async function buildGraduatedEntry(token) {
  const address = token.address;
  const name = token.name;

  let marketCapUSD = toNumberOrNull(token?.tokenPrice?.marketCap);
  if (marketCapUSD != null) marketCapUSD = marketCapUSD * 1100;

  const owners = await fetchOwners(address);
  const holders = buildHolders(owners);

  const stats = pickStatsFromTokenPrice(token);

  return { address, name, marketCapUSD, holders, stats };
}


async function processList(url, builder, take = 10) {
  const list = await fetchFourMemeTokens(url);
  const top = list.slice(0, take);

  const CONCURRENCY = 3;
  const outputs = [];

  for (let i = 0; i < top.length; i += CONCURRENCY) {
    const batch = top.slice(i, i + CONCURRENCY).map(async (t) => {
      try {
        return await builder(t);
      } catch (e) {
        console.error(`⚠️ Ошибка по токену ${t.address}:`, e.message);
        return null;
      }
    });
    const settled = await Promise.all(batch);
    outputs.push(...settled.filter(Boolean));
    if (i + CONCURRENCY < top.length) await sleep(300);
  }

  return outputs;
}

async function runOnce() {
  try {
    const bonding = await processList(FOUR_MEME_BONDING_URL, buildBondingEntry, 10);
    const graduated = await processList(FOUR_MEME_GRADUATED_URL, buildGraduatedEntry, 10);
    return { Bonding: bonding, Graduated: graduated };
  } catch (e) {
    console.error('❌ runOnce error:', e.message);
    return null;
  }
}
export { runOnce };