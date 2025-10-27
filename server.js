import express from 'express';
import chokidar from 'chokidar';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import TelegramBot from 'node-telegram-bot-api';

import { runOnce } from './fourmeme.js';
import { sendToAllAIs } from './AI.js';

import { getAiWallet, getAllAiWallets } from './trade.js';
import {
  fetchLogs,
  fetchPositions,
  DB_PATH,

  
  getAllLatestPositions,
  getLatestPosition,
  getRealizedPnlAll,
  getRealizedPnlByWallet,
  getRealizedPnlByWalletToken,
  getRealizedTotalsAll,
  getRealizedTotalsByWallet,
  getRealizedTotalsGroupedByWallet,
  getOpenTokensAllWallets,
  getOpenTokensForWallet,
  getOpenCostBasisForWallet,
  getBalanceTimeline,
  getAllTradesReasons,
  getAllTrades,
  getTradesByWallet,
  getRealizedRowsByWalletToken,
} from './db.js';
async function main() {
  try {
    console.log('start')
    const data = await runOnce();
    if (!data) return;
    await sendToAllAIs(data);
  } catch (e) {
    console.error('⚠️ Error in main loop:', e.message);
  }
}

const BOT_TOKEN = 'YOUR TOKEN';
const GROUP_CHAT_ID = YOUR_CHAT; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let MAIN_TIMER = null;

let LOOP_ENABLED = false;
const LOOP_PERIOD_MS = 30_000;
let loopTimer = null;
let cycleInFlight = false;

async function tick() {
  if (!LOOP_ENABLED) return;
  if (cycleInFlight) return; 

  cycleInFlight = true;
  try {
    console.log('start tick');
    const data = await runOnce();
    if (data) {
      await sendToAllAIs(data); 
    }
  } catch (e) {
    console.error('⚠️ Error in tick:', e.message);
  } finally {
    cycleInFlight = false;
    
    if (LOOP_ENABLED) {
      loopTimer = setTimeout(tick, LOOP_PERIOD_MS);
    }
  }
}
function pickSoldBnbForSell(realizedRows, sellTs) {
  if (!Array.isArray(realizedRows) || realizedRows.length === 0) return null;
  const sellT = new Date(sellTs).getTime();
  const notEarlier = realizedRows.find(r => new Date(r.ts).getTime() >= sellT);
  if (notEarlier) return Number(notEarlier.sold_bnb ?? null);

  let best = null, bestDiff = Infinity;
  for (const r of realizedRows) {
    const dt = Math.abs(new Date(r.ts).getTime() - sellT);
    if (dt < bestDiff) { best = r; bestDiff = dt; }
  }
  return best ? Number(best.sold_bnb ?? null) : null;
}
function startMainLoop() {
  if (LOOP_ENABLED) return false;
  LOOP_ENABLED = true;
  tick(); 
  return true;
}

function stopMainLoop() {
  if (!LOOP_ENABLED) return false;
  LOOP_ENABLED = false;
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  return true;
}

bot.onText(/^\/start\b/i, (msg) => {
  if (msg?.chat?.id !== GROUP_CHAT_ID) return;
  const started = startMainLoop();
  bot.sendMessage(GROUP_CHAT_ID, started
    ? '✅ Main loop started (every 30s).'
    : '⚙️ Main loop is already running.');
});


bot.onText(/^\/stop\b/i, (msg) => {
  if (msg?.chat?.id !== GROUP_CHAT_ID) return;
  const stopped = stopMainLoop();
  bot.sendMessage(GROUP_CHAT_ID, stopped
    ? '🛑 Main loop stopped.'
    : 'ℹ️ Main loop is not running.');
});

function keyVariantsFromModel(model) {
  const m = String(model);
  const v = new Set([
    m,                                
    m.replaceAll('/', '-'),           
    m.replaceAll('.', '-'),           
    m.replaceAll('/', '-').replaceAll('.', '-'), 
  ]);
  return Array.from(v);
}

function keyVariantsFromFileModelKey(fileModelKey) {
  
  const base = String(fileModelKey).replace(/-position$/i, '');
  const v = new Set([
    base,                 
    base.replaceAll('.', '-'), 
  ]);
  return Array.from(v);
}


const PUBLIC_DIR = path.resolve('./public');
const PORT = process.env.PORT || 3000;


const state = {
  balanceTimeline: {},
  allTradesReasons: {},
};
const toISO = (s) => new Date(s).toISOString();
const isISO = (s) => !Number.isNaN(Date.parse(s));

const extractReason = (message = '') => {
  const m = String(message).match(/reason:\s*([\s\S]*)$/i);
  return m ? m[1].trim() : null;
};
async function loadLogsFromDB() {
  const rows = fetchLogs(); 
  
  return rows
    .map(r => ({
      time: isISO(r.time) ? toISO(r.time) : toISO(new Date(r.time)),
      model: r.model,
      message: r.message ?? '',
    }))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}

async function loadPositionsPerModelFromDB() {
  
  return fetchPositions();
}

function findClosestSnapshot(rows, tISO) {
  if (!rows || !rows.length) return null;
  const t = new Date(tISO).getTime();

  
  let prev = null;
  for (const row of rows) {
    const tt = new Date(row.time).getTime();
    if (tt <= t) prev = row; else break;
  }
  if (prev) return prev;

  
  for (const row of rows) {
    const tt = new Date(row.time).getTime();
    if (tt >= t) return row;
  }
  return rows[0];
}


async function rebuildState() {
  const [logs, posPerModel] = await Promise.all([loadLogsFromDB(), loadPositionsPerModelFromDB()]);

  
  const snapshotsIndex = { ...posPerModel }; 

  const balanceTimeline = {};
  const allTradesReasons = {};

  for (const { model, time, message } of logs) {
    
    const reason = extractReason(message);
    if (reason) {
      if (!allTradesReasons[model]) allTradesReasons[model] = [];
      allTradesReasons[model].push({ time, reason });
    }

    
    const rows = snapshotsIndex[model] || null;
    if (!rows) {
      const variants = keyVariantsFromModel(model);
      let found = null;
      for (const v of variants) { if (snapshotsIndex[v]) { found = snapshotsIndex[v]; break; } }
      if (!found) {
        console.warn('No snapshots rows for model', model);
      }
      if (found) {
        if (!balanceTimeline[model]) balanceTimeline[model] = [];
        const snap = findClosestSnapshot(found, time);
        const balance = snap ? snap.totalBalance : null;
        balanceTimeline[model].push({ time, balance });
        continue;
      }
    }
    let balance = null;
    if (rows && rows.length) {
      const snap = findClosestSnapshot(rows, time);
      balance = snap ? snap.totalBalance : null;
    }
    if (!balanceTimeline[model]) balanceTimeline[model] = [];
    balanceTimeline[model].push({ time, balance });
  }

  
  for (const k of Object.keys(balanceTimeline)) {
    balanceTimeline[k].sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  for (const k of Object.keys(allTradesReasons)) {
    allTradesReasons[k].sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  state.balanceTimeline = balanceTimeline;
  state.allTradesReasons = allTradesReasons;

  console.log('✅ state rebuilt:',
    Object.keys(balanceTimeline).length, 'models in balanceTimeline,',
    Object.keys(allTradesReasons).length, 'models in allTradesReasons'
  );
}
function pickRealizedRowForSell(realizedRows, sellTs) {
  if (!Array.isArray(realizedRows) || realizedRows.length === 0) return null;
  const sellT = new Date(sellTs).getTime();
  
  const notEarlier = realizedRows.find(r => new Date(r.ts).getTime() >= sellT);
  if (notEarlier) return notEarlier;

  
  let best = null, bestDiff = Infinity;
  for (const r of realizedRows) {
    const dt = Math.abs(new Date(r.ts).getTime() - sellT);
    if (dt < bestDiff) { best = r; bestDiff = dt; }
  }
  return best || null;
}

let rebuildTimer = null;
function scheduleRebuild(immediate = false) {
  if (immediate) {
    if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
    rebuildState().catch(err => console.error('rebuild error:', err?.message || err));
    return;
  }
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildState().catch(err => console.error('rebuild error:', err?.message || err));
    rebuildTimer = null;
  }, 200);
}


async function startApi() {
  await rebuildState(); 

  
  chokidar.watch([DB_PATH], { ignoreInitial: true, depth: 0 })
    .on('add', () => scheduleRebuild())
    .on('change', () => scheduleRebuild())
    .on('unlink', () => scheduleRebuild())
    .on('error', (e) => console.error('watch error:', e?.message || e));

  const app = express();

  
  app.use(express.static(PUBLIC_DIR));
app.get(['/about', '/about/'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'about.html'));
});
  app.get('/balanceTimeline', (req, res) => {
    try {
      res.json(getBalanceTimeline());
    } catch (e) {
      console.error('GET /balanceTimeline error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });
app.get('/actions/derived', (req, res) => {
  try {
    const aiParam    = (req.query.ai     ?? '').toString().trim();
    const tokenParam = (req.query.token  ?? '').toString().trim().toLowerCase();
    let   walletLC   = (req.query.wallet ?? '').toString().trim().toLowerCase();

    
    const walletToAi = {};
    const allAiWallets = getAllAiWallets(); 
    for (const [aiName, addr] of Object.entries(allAiWallets || {})) {
      if (addr) walletToAi[String(addr).toLowerCase()] = aiName;
    }

    
    let trades = [];
    if (!aiParam && !walletLC && !tokenParam) {
      trades = getAllTrades();                         
    } else if (walletLC) {
      trades = getTradesByWallet(walletLC);            
    } else if (aiParam) {
      const walletForAi = Object.entries(walletToAi).find(([, name]) => name === aiParam)?.[0] || '';
      if (!walletForAi) return res.status(404).json({ error: 'not_found', message: `No wallet mapped for ai=${aiParam}` });
      walletLC = walletForAi.toLowerCase();
      trades = getTradesByWallet(walletLC);
    } else {
      trades = getAllTrades();
    }
    
    let buys = trades.filter(t => t.side === 'Buy');
    if (tokenParam) {
      buys = buys.filter(t => String(t.token_address).toLowerCase() === tokenParam);
    }
    if (walletLC) {
      buys = buys.filter(t => String(t.wallet).toLowerCase() === walletLC);
    }
    if (aiParam) {
      buys = buys.filter(t => walletToAi[String(t.wallet).toLowerCase()] === aiParam);
    }

    
    let realized = [];
    if (!aiParam && !walletLC && !tokenParam) {
      realized = getRealizedPnlAll();
    } else if (walletLC) {
      realized = getRealizedPnlByWallet(walletLC);
    } else if (aiParam) {
      const walletForAi = Object.entries(walletToAi).find(([, name]) => name === aiParam)?.[0] || '';
      if (!walletForAi) return res.status(404).json({ error: 'not_found', message: `No wallet mapped for ai=${aiParam}` });
      realized = getRealizedPnlByWallet(walletForAi.toLowerCase());
    } else if (tokenParam) {
      
      realized = getRealizedPnlAll().filter(r => String(r.token_address).toLowerCase() === tokenParam);
    }

    if (tokenParam) {
      realized = realized.filter(r => String(r.token_address).toLowerCase() === tokenParam);
    }

    
    const buyEvents = buys.map(t => {
      const w = String(t.wallet).toLowerCase();
      return {
        ts: t.ts,
        wallet: w,
        ai: walletToAi[w] || null,
        token: String(t.token_address).toLowerCase(),
        type: 'Buy',
        amount_bnb: Number(t.amount_bnb ?? 0) || 0
      };
    });

    const sellEvents = realized.map(r => {
      const w = String(r.wallet).toLowerCase();
      return {
        ts: r.ts,
        wallet: w,
        ai: walletToAi[w] || null,
        token: String(r.token_address).toLowerCase(),
        type: 'Sell',
        amount_bnb: Number(r.sold_bnb ?? 0) || 0,   
        pnl_bnb: Number(r.pnl_bnb ?? 0) || 0,
        pnl_pct: Number.isFinite(+r.pnl_pct) ? +r.pnl_pct : (
          Number(r.invested_bnb) ? ((Number(r.pnl_bnb)/Number(r.invested_bnb))*100) : 0
        )
      };
    });

    const all = buyEvents.concat(sellEvents);
    
    all.sort((a, b) => new Date(a.ts) - new Date(b.ts));

    res.json(all);
  } catch (e) {
    console.error('GET /actions/derived error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});
  app.get('/allTradesReasons', (req, res) => {
    try {
      res.json(getAllTradesReasons());
    } catch (e) {
      console.error('GET /allTradesReasons error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });
    app.get('/positions/latest', (req, res) => {
    try {
      const ai = (req.query.ai ?? '').toString().trim();
      if (ai) {
        const row = getLatestPosition(ai);
        if (!row) return res.status(404).json({ error: 'not_found', message: `no snapshot for ai=${ai}` });
        return res.json(row);
      }
      const all = getAllLatestPositions();
      return res.json(all);
    } catch (e) {
      console.error('GET /positions/latest error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  
  app.get('/positions/ai/:name/latest', (req, res) => {
    try {
      const ai = (req.params.name ?? '').toString().trim();
      const row = getLatestPosition(ai);
      if (!row) return res.status(404).json({ error: 'not_found', message: `no snapshot for ai=${ai}` });
      res.json(row);
    } catch (e) {
      console.error('GET /positions/ai/:name/latest error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  

  
  
  
  app.get('/pnl/realized/summary', (req, res) => {
    try {
      const wallet = (req.query.wallet ?? '').toString().trim().toLowerCase();
      if (wallet) {
        const out = getRealizedTotalsByWallet(wallet);
        return res.json(out);
      }
      const all = getRealizedTotalsAll();
      return res.json(all);
    } catch (e) {
      console.error('GET /pnl/realized/summary error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  
  
  app.get('/pnl/realized/by-wallet', (req, res) => {
    try {
      const map = getRealizedTotalsGroupedByWallet();
      res.json(map);
    } catch (e) {
      console.error('GET /pnl/realized/by-wallet error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  
  
  
  
  app.get('/pnl/realized/events', (req, res) => {
    try {
      const wallet = (req.query.wallet ?? '').toString().trim().toLowerCase();
      const token  = (req.query.token  ?? '').toString().trim().toLowerCase();
      if (wallet && token) {
        return res.json(getRealizedPnlByWalletToken(wallet, token));
      }
      if (wallet) {
        return res.json(getRealizedPnlByWallet(wallet));
      }
      return res.json(getRealizedPnlAll());
    } catch (e) {
      console.error('GET /pnl/realized/events error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  

  
  
  
  app.get('/wallets/open-tokens', (req, res) => {
    try {
      const wallet = (req.query.wallet ?? '').toString().trim().toLowerCase();
      if (wallet) {
        return res.json(getOpenTokensForWallet(wallet));
      }
      return res.json(getOpenTokensAllWallets());
    } catch (e) {
      console.error('GET /wallets/open-tokens error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  
  
  app.get('/wallets/open-cost-basis', (req, res) => {
    try {
      const wallet = (req.query.wallet ?? '').toString().trim().toLowerCase();
      if (!wallet) return res.status(400).json({ error: 'bad_request', message: 'wallet query param required' });
      const map = getOpenCostBasisForWallet(wallet);
      res.json(map);
    } catch (e) {
      console.error('GET /wallets/open-cost-basis error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`Static from ${PUBLIC_DIR}`);
  });
}


startApi().catch((e) => {
  console.error('Failed to start API:', e);
  process.exit(1);
});