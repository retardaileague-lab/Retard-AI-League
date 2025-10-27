
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DB_FILE = path.resolve('./data.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');


db.exec(`
CREATE TABLE IF NOT EXISTS logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  time      TEXT    NOT NULL,
  model     TEXT    NOT NULL,
  message   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ai_name   TEXT    NOT NULL,
  ts        TEXT    NOT NULL,
  data_json TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet        TEXT    NOT NULL,
  token_address TEXT    NOT NULL,
  side          TEXT    NOT NULL CHECK (side IN ('Buy','Sell')),
  amount_bnb    REAL,      -- для Buy (BNB)
  percent       REAL,      -- для Sell (обычно 100)
  ts            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_time           ON logs(time);
CREATE INDEX IF NOT EXISTS idx_positions_ai_ts     ON positions(ai_name, ts);
CREATE INDEX IF NOT EXISTS idx_trades_wallet_token ON trades(wallet, token_address, ts);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS realized_pnl (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet        TEXT NOT NULL,
  token_address TEXT NOT NULL,
  pnl_bnb       REAL NOT NULL,   -- PnL в BNB (realized)
  pnl_pct       REAL NOT NULL,   -- PnL в %
  sold_bnb      REAL NOT NULL,   -- за сколько фактически продали (оценка в BNB)
  invested_bnb  REAL NOT NULL,   -- сколько всего было вложено по этому токену
  ts            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realized_pnl_wallet_token ON realized_pnl(wallet, token_address, ts);
`);

const stmtInsertRealized = db.prepare(`
  INSERT INTO realized_pnl (wallet, token_address, pnl_bnb, pnl_pct, sold_bnb, invested_bnb, ts)
  VALUES (@wallet, @token_address, @pnl_bnb, @pnl_pct, @sold_bnb, @invested_bnb, @ts)
`);

export function recordRealizedPnl(wallet, tokenAddress, { pnlBNB, pnlPct, soldBNB, investedBNB }) {
  stmtInsertRealized.run({
    wallet,
    token_address: tokenAddress,
    pnl_bnb: Number(pnlBNB) || 0,
    pnl_pct: Number(pnlPct) || 0,
    sold_bnb: Number(soldBNB) || 0,
    invested_bnb: Number(investedBNB) || 0,
    ts: new Date().toISOString(),
  });
}
const stmtInsertLog = db.prepare(`
  INSERT INTO logs (time, model, message) VALUES (@time, @model, @message)
`);
const stmtInsertPos = db.prepare(`
  INSERT INTO positions (ai_name, ts, data_json) VALUES (@ai_name, @ts, @data_json)
`);
const stmtInsertTrade = db.prepare(`
  INSERT INTO trades (wallet, token_address, side, amount_bnb, percent, ts)
  VALUES (@wallet, @token_address, @side, @amount_bnb, @percent, @ts)
`);
const stmtSumBuys = db.prepare(`
  SELECT COALESCE(SUM(amount_bnb), 0) AS invested
  FROM trades
  WHERE wallet = ? AND token_address = ? AND side = 'Buy'
`);

export function saveLog(model, message) {
  stmtInsertLog.run({ time: new Date().toISOString(), model, message: String(message ?? '').trim() });
}

export function savePositionSnapshot(aiName, dataObj) {
  stmtInsertPos.run({
    ai_name: aiName,
    ts: new Date().toISOString(),
    data_json: JSON.stringify(dataObj ?? {}, null, 2),
  });
}

export function recordBuyDB(wallet, tokenAddress, amountBNB) {
  stmtInsertTrade.run({
    wallet,
    token_address: tokenAddress,
    side: 'Buy',
    amount_bnb: Number(amountBNB) || 0,
    percent: null,
    ts: new Date().toISOString(),
  });
}

export function recordSellDB(wallet, tokenAddress, percent) {
  stmtInsertTrade.run({
    wallet,
    token_address: tokenAddress,
    side: 'Sell',
    amount_bnb: null,
    percent: Number(percent) || 0,
    ts: new Date().toISOString(),
  });
}

export function getInvestedBNB(wallet, tokenAddress) {
  const row = stmtSumBuys.get(wallet, tokenAddress);
  return Number(row?.invested || 0);
}

export const DB_PATH = DB_FILE;

const qAllLogs = db.prepare(`
  SELECT time, model, message
  FROM logs
  ORDER BY time ASC
`);

const qAllPositions = db.prepare(`
  SELECT ai_name, ts, data_json
  FROM positions
  ORDER BY ts ASC
`);

export function fetchLogs() {
  return qAllLogsAsc.all();
}

export function fetchPositions() {
  const rows = qAllPositionsAsc.all();
  const byAi = Object.create(null);

  for (const r of rows) {
    let snap = {};
    try { snap = JSON.parse(r.data_json || '{}'); } catch { snap = {}; }

    
    let total = 0;
    for (const [k, v] of Object.entries(snap || {})) {
      if (!v || typeof v !== 'object') continue;
      if (k === 'BNB') total += Number(v.amount || 0) || 0;
      else            total += Number(v.balance || 0) || 0;
    }
    total = Number(total.toFixed(8));

    if (!byAi[r.ai_name]) byAi[r.ai_name] = [];
    byAi[r.ai_name].push({
      time: r.ts,
      snapshot: snap,
      totalBalance: Number.isFinite(total) ? total : null,
    });
  }

  
  for (const k of Object.keys(byAi)) {
    byAi[k].sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  return byAi;
}

const stmtLastFullExit = db.prepare(`
  SELECT MAX(ts) AS ts
  FROM trades
  WHERE wallet = ?
    AND token_address = ?
    AND side = 'Sell'
    AND (percent >= 99.999 OR percent = 100)
`);

const stmtSumBuysSince = db.prepare(`
  SELECT COALESCE(SUM(amount_bnb), 0) AS invested
  FROM trades
  WHERE wallet = ?
    AND token_address = ?
    AND side = 'Buy'
    AND ts > ?
`);


export function getOpenCostBasisBNB(wallet, tokenAddress) {
  const lastExit = stmtLastFullExit.get(wallet, tokenAddress);
  const sinceTs = lastExit?.ts || '0000-01-01T00:00:00.000Z';
  const row = stmtSumBuysSince.get(wallet, tokenAddress, sinceTs);
  return Number(row?.invested || 0);
}


db.exec(`
CREATE TABLE IF NOT EXISTS wallet_tokens (
  wallet        TEXT NOT NULL,
  token_address TEXT NOT NULL,
  PRIMARY KEY (wallet, token_address)
);

CREATE INDEX IF NOT EXISTS idx_wallet_tokens_wallet ON wallet_tokens(wallet);
`);


function normAddr(x) { return String(x || '').toLowerCase(); }


const stmtAddWalletToken    = db.prepare(`INSERT OR IGNORE INTO wallet_tokens (wallet, token_address) VALUES (?, ?)`); 
const stmtRemoveWalletToken = db.prepare(`DELETE FROM wallet_tokens WHERE wallet = ? AND token_address = ?`);
const stmtListWalletTokens  = db.prepare(`SELECT token_address FROM wallet_tokens WHERE wallet = ? ORDER BY token_address`);


export function addTokenForWalletDB(wallet, tokenAddress) {
  stmtAddWalletToken.run(normAddr(wallet), normAddr(tokenAddress));
}

export function removeTokenForWalletDB(wallet, tokenAddress) {
  stmtRemoveWalletToken.run(normAddr(wallet), normAddr(tokenAddress));
}

export function getWalletRegistryDB(wallet) {
  const rows = stmtListWalletTokens.all(normAddr(wallet));
  return rows.map(r => r.token_address);
}

const qLatestSnapshotAll = db.prepare(`
  WITH mx AS (
    SELECT ai_name, MAX(ts) AS ts
    FROM positions
    GROUP BY ai_name
  )
  SELECT p.ai_name, p.ts, p.data_json
  FROM positions p
  JOIN mx ON mx.ai_name = p.ai_name AND mx.ts = p.ts
  ORDER BY p.ai_name
`);

const qLatestSnapshotOne = db.prepare(`
  SELECT ai_name, ts, data_json
  FROM positions
  WHERE ai_name = ?
  ORDER BY ts DESC
  LIMIT 1
`);


function calcTotalBalanceFromSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return null;
  let total = 0;
  for (const [k, v] of Object.entries(snap)) {
    if (!v || typeof v !== 'object') continue;
    if (k === 'BNB') total += Number(v.amount || 0) || 0;
    else             total += Number(v.balance || 0) || 0;
  }
  total = Number(total.toFixed(8));
  return Number.isFinite(total) ? total : null;
}


export function getLatestPosition(aiName) {
  const row = qLatestSnapshotOne.get(aiName);
  if (!row) return null;
  let snap = {};
  try { snap = JSON.parse(row.data_json || '{}'); } catch { snap = {}; }
  return {
    ai_name: row.ai_name,
    time: row.ts,
    snapshot: snap,
    totalBalance: calcTotalBalanceFromSnapshot(snap),
  };
}


export function getAllLatestPositions() {
  const rows = qLatestSnapshotAll.all();
  const out = {};
  for (const r of rows) {
    let snap = {};
    try { snap = JSON.parse(r.data_json || '{}'); } catch { snap = {}; }
    out[r.ai_name] = {
      time: r.ts,
      snapshot: snap,
      totalBalance: calcTotalBalanceFromSnapshot(snap),
    };
  }
  return out;
}




const qRealizedAll = db.prepare(`
  SELECT wallet, token_address, pnl_bnb, pnl_pct, sold_bnb, invested_bnb, ts
  FROM realized_pnl
  ORDER BY ts ASC
`);

const qRealizedByWallet = db.prepare(`
  SELECT wallet, token_address, pnl_bnb, pnl_pct, sold_bnb, invested_bnb, ts
  FROM realized_pnl
  WHERE wallet = ?
  ORDER BY ts ASC
`);

const qRealizedByWalletToken = db.prepare(`
  SELECT wallet, token_address, pnl_bnb, pnl_pct, sold_bnb, invested_bnb, ts
  FROM realized_pnl
  WHERE wallet = ? AND token_address = ?
  ORDER BY ts ASC
`);

const qRealizedTotalsAll = db.prepare(`
  SELECT
    COALESCE(SUM(pnl_bnb), 0)      AS sum_pnl_bnb,
    COALESCE(SUM(invested_bnb), 0) AS sum_invested_bnb,
    COALESCE(SUM(sold_bnb), 0)     AS sum_sold_bnb
  FROM realized_pnl
`);

const qRealizedTotalsByWallet = db.prepare(`
  SELECT
    wallet,
    COALESCE(SUM(pnl_bnb), 0)      AS sum_pnl_bnb,
    COALESCE(SUM(invested_bnb), 0) AS sum_invested_bnb,
    COALESCE(SUM(sold_bnb), 0)     AS sum_sold_bnb
  FROM realized_pnl
  WHERE wallet = ?
  GROUP BY wallet
`);

const qRealizedTotalsGroupByWallet = db.prepare(`
  SELECT
    wallet,
    COALESCE(SUM(pnl_bnb), 0)      AS sum_pnl_bnb,
    COALESCE(SUM(invested_bnb), 0) AS sum_invested_bnb,
    COALESCE(SUM(sold_bnb), 0)     AS sum_sold_bnb
  FROM realized_pnl
  GROUP BY wallet
`);

export function getRealizedPnlAll() {
  return qRealizedAll.all();
}

export function getRealizedPnlByWallet(wallet) {
  return qRealizedByWallet.all(wallet.toLowerCase());
}

export function getRealizedPnlByWalletToken(wallet, tokenAddress) {
  return qRealizedByWalletToken.all(wallet.toLowerCase(), tokenAddress.toLowerCase());
}

export function getRealizedTotalsAll() {
  const r = qRealizedTotalsAll.get();
  const invested = Number(r?.sum_invested_bnb || 0);
  const pnlBNB   = Number(r?.sum_pnl_bnb || 0);
  const soldBNB  = Number(r?.sum_sold_bnb || 0);
  const pct      = invested > 0 ? (pnlBNB / invested) * 100 : 0;
  return {
    pnl_bnb: pnlBNB,
    pnl_pct: Number(pct.toFixed(2)),
    invested_bnb: invested,
    sold_bnb: soldBNB,
  };
}

export function getRealizedTotalsByWallet(wallet) {
  const r = qRealizedTotalsByWallet.get(wallet.toLowerCase());
  if (!r) return { wallet, pnl_bnb: 0, pnl_pct: 0, invested_bnb: 0, sold_bnb: 0 };
  const invested = Number(r.sum_invested_bnb || 0);
  const pnlBNB   = Number(r.sum_pnl_bnb || 0);
  const soldBNB  = Number(r.sum_sold_bnb || 0);
  const pct      = invested > 0 ? (pnlBNB / invested) * 100 : 0;
  return {
    wallet: r.wallet,
    pnl_bnb: pnlBNB,
    pnl_pct: Number(pct.toFixed(2)),
    invested_bnb: invested,
    sold_bnb: soldBNB,
  };
}


export function getRealizedTotalsGroupedByWallet() {
  const rows = qRealizedTotalsGroupByWallet.all();
  const out = {};
  for (const r of rows) {
    const invested = Number(r.sum_invested_bnb || 0);
    const pnlBNB   = Number(r.sum_pnl_bnb || 0);
    const soldBNB  = Number(r.sum_sold_bnb || 0);
    const pct      = invested > 0 ? (pnlBNB / invested) * 100 : 0;
    out[r.wallet] = {
      pnl_bnb: pnlBNB,
      pnl_pct: Number(pct.toFixed(2)),
      invested_bnb: invested,
      sold_bnb: soldBNB,
    };
  }
  return out;
}




const qListWalletTokens = db.prepare(`
  SELECT wallet, token_address
  FROM wallet_tokens
  ORDER BY wallet, token_address
`);

const qListWalletTokensByWallet = db.prepare(`
  SELECT token_address
  FROM wallet_tokens
  WHERE wallet = ?
  ORDER BY token_address
`);


export function getOpenTokensAllWallets() {
  const rows = qListWalletTokens.all();
  const out = {};
  for (const r of rows) {
    if (!out[r.wallet]) out[r.wallet] = [];
    out[r.wallet].push(r.token_address);
  }
  return out;
}


export function getOpenTokensForWallet(wallet) {
  return qListWalletTokensByWallet.all(wallet.toLowerCase()).map(r => r.token_address);
}


export function getOpenCostBasisForWallet(wallet) {
  const tokens = getOpenTokensForWallet(wallet);
  const out = {};
  for (const t of tokens) {
    out[t] = getOpenCostBasisBNB(wallet, t);
  }
  return out;
}

const qAllLogsAsc = db.prepare(`
  SELECT time, model, message
  FROM logs
  ORDER BY time ASC
`);

const qAllPositionsAsc = db.prepare(`
  SELECT ai_name, ts, data_json
  FROM positions
  ORDER BY ai_name ASC, ts ASC
`);

function isISO(ts) { return !Number.isNaN(Date.parse(ts)); }
function toISO(ts) { return new Date(ts).toISOString(); }


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
  return rows[0] || null;
}


function extractReason(message = '') {
  const m = String(message).match(/reason:\s*([\s\S]*)$/i);
  return m ? m[1].trim() : null;
}


export function getBalanceTimeline() {
  
  const logs = qAllLogsAsc.all().map(r => ({
    time: isISO(r.time) ? toISO(r.time) : toISO(new Date(r.time)),
    model: r.model,
    message: r.message ?? '',
  }));

  
  const posRows = qAllPositionsAsc.all();
  const snapshotsIndex = Object.create(null);
  for (const r of posRows) {
    let snap = {};
    try { snap = JSON.parse(r.data_json || '{}'); } catch { snap = {}; }
    const row = {
      time: r.ts,
      totalBalance: calcTotalBalanceFromSnapshot(snap),
    };
    if (!snapshotsIndex[r.ai_name]) snapshotsIndex[r.ai_name] = [];
    snapshotsIndex[r.ai_name].push(row);
  }

  
  const balanceTimeline = {};
  for (const { model, time } of logs) {
    const rows = snapshotsIndex[model] || null;

    
    let useRows = rows;
    if (!useRows) {
      const variants = new Set([
        model,
        model.replaceAll('/', '-'),
        model.replaceAll('.', '-'),
        model.replaceAll('/', '-').replaceAll('.', '-'),
      ]);
      for (const v of variants) {
        if (snapshotsIndex[v]) { useRows = snapshotsIndex[v]; break; }
      }
    }

    let balance = null;
    if (useRows && useRows.length) {
      const snap = findClosestSnapshot(useRows, time);
      balance = snap ? snap.totalBalance : null;
    }

    if (!balanceTimeline[model]) balanceTimeline[model] = [];
    balanceTimeline[model].push({ time, balance });
  }

  
  for (const k of Object.keys(balanceTimeline)) {
    balanceTimeline[k].sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  return balanceTimeline;
}


export function getAllTradesReasons() {
  const logs = qAllLogsAsc.all().map(r => ({
    time: isISO(r.time) ? toISO(r.time) : toISO(new Date(r.time)),
    model: r.model,
    message: r.message ?? '',
  }));
  const out = {};
  for (const { model, time, message } of logs) {
    const reason = extractReason(message);
    if (!reason) continue;
    if (!out[model]) out[model] = [];
    out[model].push({ time, reason });
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  return out;
}

const qTradesByWalletAsc = db.prepare(`
  SELECT wallet, token_address, side, amount_bnb, percent, ts
  FROM trades
  WHERE wallet = ?
  ORDER BY ts ASC
`);

const qRealizedByWalletTokenAsc = db.prepare(`
  SELECT wallet, token_address, pnl_bnb, pnl_pct, sold_bnb, invested_bnb, ts
  FROM realized_pnl
  WHERE wallet = ? AND token_address = ?
  ORDER BY ts ASC
`);
const qAllTradesAsc = db.prepare(`
  SELECT wallet, token_address, side, amount_bnb, percent, ts
  FROM trades
  ORDER BY ts ASC
`);

export function getTradesByWallet(wallet) {
  return qTradesByWalletAsc.all(String(wallet).toLowerCase());
}

export function getRealizedRowsByWalletToken(wallet, token) {
  return qRealizedByWalletTokenAsc.all(String(wallet).toLowerCase(), String(token).toLowerCase());
}
export function getAllTrades() {
  return qAllTradesAsc.all();
}