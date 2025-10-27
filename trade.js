import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto'; 
dotenv.config({ path: './config.env' });
  const { ethers } = await import('ethers');
const MORALIS_BASE = 'https://deep-index.moralis.io/api/v2.2';

const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  throw new Error('AUTH_TOKEN is missing in config.env');
}
const FM_QUERY_BASE =
  'https://four.meme/meme-api/v1/private/token/query?orderBy=Query&listedPancake=false&pageIndex=1&pageSize=30&symbol=&labels=';

const SWAP_URL = 'https://evm.bloom-ext.app/swap';
const CHAIN_ID = 'BSC';
const NATIVE_BNB_ADDR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
let AI_WALLETS = Object.create(null);
import {
  recordBuyDB,
  recordSellDB,
  savePositionSnapshot,
  getInvestedBNB,
  recordRealizedPnl,
  getOpenCostBasisBNB,
  addTokenForWalletDB,
  removeTokenForWalletDB,
  getWalletRegistryDB
} from './db.js';
const BALANCE_DELAY_MS = 3000;
const DELTA_EPS = 1e-12;
  
  const RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';

let LAST_BNB_USD = null;
async function saveAiPositions(aiName, data) {
  
  await fs.mkdir(POSITIONS_DIR, { recursive: true });

  
  const safeName = aiName
    .replace(/[^a-z0-9\-_.]/gi, '-')
    .replace(/\s+/g, '-')
    .toLowerCase();
  const filePath = path.join(POSITIONS_DIR, `${safeName}-position.json`);

  
  let existing = {};
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    existing = raw ? JSON.parse(raw) : {};
  } catch {
    existing = {};
  }

  
  const timestamp = new Date().toISOString();
  existing[timestamp] = data;

  
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2));
}

export function getAllAiWallets() {
  return { ...AI_WALLETS };
}



async function withRetry(fn, {
  retries = 3,       
  baseDelayMs = 500, 
  factor = 2,        
  jitterMs = 150     
} = {}) {
  let attempt = 0, lastErr;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      attempt += 1;
      if (attempt >= retries) break;
      const delay = baseDelayMs * (factor ** (attempt - 1)) + Math.random() * jitterMs;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}



function isEvmAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr).trim());
}


function generateQT(prefix) {
  return `QT-${Date.now()}-${prefix}-${randomUUID()}`;
}


export function setAiWallets(map) {
  if (!map || typeof map !== 'object') throw new Error('setAiWallets: map is required');
  for (const [ai, addr] of Object.entries(map)) {
    if (!isEvmAddress(addr)) throw new Error(`setAiWallets: invalid address for ${ai}`);
  }
  AI_WALLETS = { ...map };
}
export function getAiWallet(ai) {
  return AI_WALLETS[ai] || null;
}


setAiWallets({
  'openai/gpt-5': '0x645AB91bE1e004A70C0af80e0238176C1aEA4217',
  'anthropic/claude-sonnet-4.5': '0xbDe0B5f5192e19E55dF29612D14036af7A8e04A8',
  'deepseek/deepseek-chat-v3.1': '0x59263161D3801d22564733C48EdFF68e38316994',
  'x-ai/grok-4': '0x52f7D953A936FBe2C171385475BfC881935595d0',
  'google/gemini-2.5-pro': '0x39443fBfA6EF376B16121905122f2A4e4b3A48F2'
});


async function postSwap(payload) {
  return withRetry(async () => {
    const res = await fetch(SWAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

    if (!res.ok) {
      const msg = json?.message || res.statusText || 'Swap API error';
      throw new Error(`Swap HTTP ${res.status}: ${msg}`);
    }
    return json;
  }, { retries: 4, baseDelayMs: 600 });
}
export async function buy(address, amountBNB, ai) {
  if (!isEvmAddress(address)) throw new Error('Invalid token address');
  const amount = Number(amountBNB);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount');

  const wallet = getAiWallet(ai);
  if (!wallet) throw new Error(`No wallet mapped for AI: ${ai}`);
  if (!isEvmAddress(wallet)) throw new Error(`Mapped wallet is invalid for AI: ${ai}`);

  const before = await getTokenBalance(wallet, address);

  const payload = {
    id: generateQT('buy'),
    chain_id: CHAIN_ID,
    auth_token: AUTH_TOKEN,
    address,
    side: 'Buy',
    amount,
    fee: 3,
    slippage: 50,
    anti_mev: true,
    wallet_addresses: [wallet],
    dev_sell: null,
    bundle_tip: 0.000005,
  };

  console.log(`🚀 BUY ${amount} BNB of ${address} [AI: ${ai}] [wallet: ${wallet}] [id: ${payload.id}]`);
  const result = await postSwap(payload);

  
  await new Promise(r => setTimeout(r, BALANCE_DELAY_MS));

  const after = await getTokenBalance(wallet, address);
  const delta = (after && before) ? (after.amount - before.amount) : null;

  console.log(
    `📊 BUY balance ${address} [wallet: ${wallet}] — before=${before.amount} (dec=${before.decimals}), after=${after.amount} (dec=${after.decimals})${delta != null ? `, delta=${delta}` : ''}`
  );

  
  const credited = (delta != null && Math.abs(delta) >= DELTA_EPS);
  if (!(result?.success === true && credited)) {
    console.warn(
      `⚠️ BUY ignored: ${
        result?.success === true ? 'no credit on-chain (delta≈0)' : 'swap API failed'
      } for ${address} [wallet: ${wallet}]`
    );
    return {
      ok: false,
      action: 'buy',
      ignored: true,
      reason: result?.success === true ? 'no balance change' : 'swap failed',
      address,
      amountBNB: amount,
      ai,
      wallet,
      id: payload.id,
      result,
    };
  }

  
  recordBuyDB(wallet, address, amount);
  addTokenForWalletDB(wallet, address);

  return { ok: true, action: 'buy', address, amountBNB: amount, ai, wallet, id: payload.id, result };
}


export async function sell(address, ai) {
  if (!isEvmAddress(address)) throw new Error('Invalid token address');

  const wallet = getAiWallet(ai);
  if (!wallet) throw new Error(`No wallet mapped for AI: ${ai}`);
  if (!isEvmAddress(wallet)) throw new Error(`Mapped wallet is invalid for AI: ${ai}`);

  const percent = 100;
  const before = await getTokenBalance(wallet, address);

  const payload = {
    id: generateQT('sell'),
    chain_id: CHAIN_ID,
    auth_token: AUTH_TOKEN,
    address,
    side: 'Sell',
    amount: percent,
    fee: 3,
    slippage: 50,
    anti_mev: true,
    wallet_addresses: [wallet],
    dev_sell: null,
    bundle_tip: 0.000005,
  };

  console.log(`💸 SELL 100% of ${address} [AI: ${ai}] [wallet: ${wallet}] [id: ${payload.id}]`);
  const result = await postSwap(payload);

  
  await new Promise(r => setTimeout(r, BALANCE_DELAY_MS));

  const after = await getTokenBalance(wallet, address);
  const delta = (after && before) ? (after.amount - before.amount) : null;
  console.log(
    `📊 SELL balance ${address} [wallet: ${wallet}] — before=${before.amount} (dec=${before.decimals}), after=${after.amount} (dec=${after.decimals})${delta != null ? `, delta=${delta}` : ''}`
  );

  if (delta == null || Math.abs(delta) < DELTA_EPS) {
    console.warn(`⚠️ SELL ignored: no balance change for ${address} [wallet: ${wallet}]`);
    return { ok: false, action: 'sell', ignored: true, reason: 'no balance change', address, percent, ai, wallet, id: payload.id, result };
  }

  if (result?.success === true) {
    recordSellDB(wallet, address, percent);
    
    const bnbUsd = LAST_BNB_USD;
    let fm = null;
    try { fm = await fetchFourMemeByAddress(address); } catch {}
    const mcRaw = toNum(fm?.tokenPrice?.marketCap);
    if (mcRaw == null || mcRaw <= 0) {
      console.warn('⚠️ SELL: cannot resolve marketCap, skipping PnL calc');
      return { ok: true, action: 'sell', address, percent, ai, wallet, id: payload.id, result };
    }

    
    let mcapBNB;
    if (mcRaw < 100) {
      mcapBNB = mcRaw;
    } else {
      if (!bnbUsd) {
        console.warn('⚠️ SELL: no cached bnbUsd, cannot convert marketCap USD→BNB; skipping PnL calc');
        return { ok: true, action: 'sell', address, percent, ai, wallet, id: payload.id, result };
      }
      mcapBNB = mcRaw / bnbUsd;
    }
    
    
    const ASSUMED_SUPPLY = 1_000_000_000; 
    const soldBNB = mcapBNB * (before.amount / ASSUMED_SUPPLY);

    
    const investedBNB = getInvestedBNB(wallet, address);

    
    const pnlBNB = soldBNB - investedBNB;
    const pnlPct = investedBNB > 0 ? ((pnlBNB / investedBNB) * 100) : 0;

    
    recordRealizedPnl(wallet, address, { pnlBNB, pnlPct, soldBNB, investedBNB });

    
    removeTokenForWalletDB(wallet, address);
  }


  return { ok: true, action: 'sell', address, percent, ai, wallet, id: payload.id, result };
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url, headers = {}) {
  return withRetry(async () => {
    const res = await fetch(encodeURI(url), { headers });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`${url} -> HTTP ${res.status} ${res.statusText} ${t || ''}`.trim());
    }
    return res.json();
  }, { retries: 3, baseDelayMs: 500 });
}

async function fetchWalletTokensFiltered(wallet, apiKey, tokenAddresses) {
  
  if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
    return { result: [] };
  }
  const params = new URLSearchParams({
    chain: 'bsc',
    exclude_spam: 'false',
    exclude_unverified_contracts: 'false',
    limit: '25',
  });
  
  for (const m of tokenAddresses) {
    params.append('token_addresses[]', String(m));
  }
  const url = `${MORALIS_BASE}/wallets/${wallet}/tokens?${params.toString()}`;
  return fetchJson(url, {
    accept: 'application/json',
    'X-API-Key': apiKey,
  });
}


async function fetchWalletTokens(wallet, apiKey) {
  
  const url = `${MORALIS_BASE}/wallets/${wallet}/tokens?chain=bsc&exclude_spam=false&exclude_unverified_contracts=false&limit=25`;
  return fetchJson(url, {
    accept: 'application/json',
    'X-API-Key': apiKey,
  });
}
async function fetchFourMemeByAddress(addr) {
  const url = `${FM_QUERY_BASE}&queryMode=Binance&tokenName=${addr}`;
  const json = await fetchJson(url, { accept: 'application/json' });
  if (json?.code !== 0 || !Array.isArray(json?.data) || json.data.length === 0) return null;
  
  const rec = json.data.find((d) => String(d?.address).toLowerCase() === String(addr).toLowerCase()) || json.data[0];
  return rec || null;
}

function fromWei(raw, decimals = 18) {
  
  const s = String(raw || '0');
  if (!/^\d+$/.test(s)) return Number(s) / 10 ** decimals; 
  if (s.length <= decimals) {
    const zeros = '0'.repeat(decimals - s.length);
    return Number(`0.${zeros}${s}`); 
  }
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, ''); 
  return Number(frac ? `${int}.${frac}` : int);
}


export async function getPositions(wallet) {
  const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
  if (!MORALIS_API_KEY) throw new Error('MORALIS_API_KEY is missing in config.env');
  if (!isEvmAddress(wallet)) throw new Error('getPositions: invalid wallet address');

  
  const registryList = getWalletRegistryDB(wallet);
  console.log(`📜 Реестр токенов для кошелька ${wallet}:`, registryList);

  
  const wAll = await fetchWalletTokens(wallet, MORALIS_API_KEY);
  const listAll = Array.isArray(wAll?.result) ? wAll.result : [];
  const native = listAll.find(
    (t) => String(t?.token_address).toLowerCase() === NATIVE_BNB_ADDR
  );

  const bnbUsd = toNum(native?.usd_price);
  if (!bnbUsd) throw new Error('getPositions: failed to resolve BNB usd_price from Moralis');
  LAST_BNB_USD = bnbUsd; 
  const out = {};
  if (native?.balance) {
    const bnbAmount = fromWei(native.balance, 18);
    out['BNB'] = {
      address: NATIVE_BNB_ADDR,
      amount: Number(bnbAmount.toFixed(8)),
    };
  }

 const ProviderCtor = ethers?.JsonRpcProvider || ethers?.providers?.JsonRpcProvider;
 if (!ProviderCtor) throw new Error('Unable to resolve JsonRpcProvider (ethers v5/v6 mismatch)');
 const provider = new ProviderCtor(RPC_URL);

  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function name() view returns (string)',
  ];

  const rpcCall = (label, fn) =>
    withRetry(fn, { retries: 3, baseDelayMs: 400, factor: 1.8, jitterMs: 120 });

  const ASSUMED_SUPPLY = 1_000_000_000; 

  for (const tokenAddr of registryList) {
    try {
      const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);

      
      const [rawBal, nm] = await Promise.all([
        rpcCall(`balanceOf ${tokenAddr}`, () => contract.balanceOf(wallet)).catch(() => 0n),
        rpcCall(`name ${tokenAddr}`, () => contract.name()).catch(() => null),
      ]);

 const formatUnits = ethers?.formatUnits || ethers?.utils?.formatUnits;
 const amount = Number(formatUnits(rawBal, 18)); 

      
      const percent = (amount / ASSUMED_SUPPLY) * 100;

      
      let fm = null;
      try { fm = await fetchFourMemeByAddress(tokenAddr); } catch {}
      if (!fm) continue;

      const name = fm?.name || nm || tokenAddr;
      const mcRaw = toNum(fm?.tokenPrice?.marketCap);
      if (mcRaw == null || mcRaw <= 0) continue;

      
      const mcapBNB = mcRaw < 100 ? mcRaw : mcRaw / bnbUsd;

      
      const balanceBNB = mcapBNB * (percent / 100);

      
      const investedBNB = getOpenCostBasisBNB(wallet, tokenAddr);
      const pnlPct = investedBNB > 0 ? ((balanceBNB - investedBNB) / investedBNB) * 100 : 0;

      out[name] = {
        address: tokenAddr,
        balance: Number(balanceBNB.toFixed(8)),
        PnL: Number(pnlPct.toFixed(2)),
      };
    } catch (e) {
      console.error(`getPositions: token ${tokenAddr} error:`, e?.message || e);
      continue;
    }
  }

  
  console.log(`\n💰 Кошелёк ${wallet} держит:`);
  for (const [key, info] of Object.entries(out)) {
    if (key === 'BNB') {
      console.log(`- BNB: ${info.amount} (${info.address})`);
    } else {
      console.log(`- ${key}: ~${info.balance} BNB (addr: ${info.address}, PnL: ${info.PnL}%)`);
    }
  }

  
  const aiName =
    Object.entries(AI_WALLETS).find(
      ([_, addr]) => String(addr).toLowerCase() === String(wallet).toLowerCase()
    )?.[0] || 'unknown-ai';

  savePositionSnapshot(aiName, out);
  return out;
}

async function getTokenBalance(wallet, tokenAddr) {
  if (!isEvmAddress(wallet)) throw new Error('getTokenBalance: invalid wallet');
  if (!isEvmAddress(tokenAddr)) throw new Error('getTokenBalance: invalid token address');

  const ProviderCtor = ethers?.JsonRpcProvider || ethers?.providers?.JsonRpcProvider;
  if (!ProviderCtor) throw new Error('Unable to resolve JsonRpcProvider (ethers v5/v6 mismatch)');
  const provider = new ProviderCtor(RPC_URL);

  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
  ];

  const rpcCall = (label, fn) =>
    withRetry(fn, { retries: 3, baseDelayMs: 400, factor: 1.8, jitterMs: 120 });

  try {
    const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
    const [rawBal, dec] = await Promise.all([
      rpcCall(`balanceOf ${tokenAddr}`, () => contract.balanceOf(wallet)),
      rpcCall(`decimals ${tokenAddr}`, () => contract.decimals()).catch(() => 18),
    ]);

    const decimals = Number(dec) || 18;
 const formatUnits = ethers?.formatUnits || ethers?.utils?.formatUnits;
 const amount = Number(formatUnits(rawBal, decimals)); 

    return { raw: rawBal, decimals, amount };
  } catch (e) {
    console.error(`getTokenBalance error for ${tokenAddr} on ${wallet}:`, e?.message || e);
    return { raw: 0n, decimals: 18, amount: 0 };
  }
}
