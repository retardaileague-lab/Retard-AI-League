import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config({ path: './config.env' });
import { promises as fs } from 'node:fs';

import { saveLog } from './db.js';

async function logAIAction(model, message) {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });

    
    const logPath = path.join(LOG_DIR, `${model.replaceAll('/', '-').replaceAll('.', '-')}.json`);
    let logs = [];
    try {
      const raw = await fs.readFile(logPath, 'utf8');
      logs = JSON.parse(raw);
      if (!Array.isArray(logs)) logs = [];
    } catch {
      logs = [];
    }

    
    logs.unshift({
      time: new Date().toISOString(),
      model,
      message: message.trim(),
    });

    
    if (logs.length > 200) logs = logs.slice(0, 200);

    await fs.writeFile(logPath, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error(`⚠️ Failed to log action for ${model}:`, e.message);
  }
}
import {
  buy as tradeBuy,
  sell as tradeSell,
  getAiWallet,
  getPositions, 
} from './trade.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY is missing. Add it to config.env');
  process.exit(1);
}

function buildIndexMapAndBlock(data, startIndex = 1) {
  const idxMap = new Map();
  const lines = [];
  let n = startIndex;

  const pushGroup = (label, arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    lines.push(`${label}:`);
    for (const t of arr) {
      const addr = t?.address || 'unknown';
      const name = t?.name || addr;
      idxMap.set(n, addr);
      lines.push(`[${n}] ${name} — ${addr}`);
      n++;
    }
    lines.push('');
  };

  pushGroup('Bonding', data?.Bonding);
  pushGroup('Graduated', data?.Graduated);

  const block = lines.length
    ? `Token index (**numbers only**):\n${lines.join('\n')}`  
    : '';

  return { idxMap, block, nextIndex: n };
}


function resolveAddress(indexLike, idxMap) {
  const s = String(indexLike).trim();
  const m = s.match(/^#?(\d{1,5})$/);   
  if (!m) return null;                  
  const num = Number(m[1]);
  return idxMap.get(num) || null;
}
function isEvmAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr).trim());
}

const MODELS = [
  'openai/gpt-5',
  'anthropic/claude-sonnet-4.5',
  'deepseek/deepseek-chat-v3.1',
  'x-ai/grok-4-fast',
  'google/gemini-2.5-flash',
];
const SYSTEM_MESSAGE = `
TRADE LIKE AN ABSOLUTE BRAINDLESS DEGEN! 🤪
If you see a token with a funny/stupid name — BUY. No brakes.  
Compete with other AIs and try to show the highest PnL!  
Forget logic — embrace chaos — but remember: going all-in too hard might wreck your balance.  
Take risky swings, chase pumps, ape into memes, but always leave some BNB for gas.  

Context:
- **BNB** is your main balance — you use it to buy and sell meme tokens.
- You must **always keep at least 0.0003 BNB** for transaction fees (gas).  
  Trade wisely and calculate carefully — never spend your entire balance.  
  If you already hold a token, you don’t have to add more — doing nothing is fine too.
- Other tokens in your portfolio are your current holdings.
- You can **buy new tokens** or **add to existing ones** if they look strong.

Competition:
- You compete with other AI traders — your goal is to achieve the **highest profit (PnL)**.
- However, **profit must still be sustainable** — avoid instant rug pulls and total wipeouts.
- Take profits when momentum weakens; don’t wait for unrealistic 100x dreams.
- Decide how much BNB to use per trade, but always check your available balance.
- Keep **at least 0.001 BNB** for gas and **NEVER** exceed your remaining balance after this reserve.
- ⚠️ **If your total BNB balance is below 0.001 BNB — you are NOT allowed to buy anything!**
  You may only **sell** existing tokens to recover BNB.
- ⚠️ **You may NEVER buy using 100% of your balance.**  
  Always leave a safety margin (minimum 0.001 BNB or 10% of total balance, whichever is greater).

Trading style:
- **Trade aggressively and with gambling spirit.** Take risks, chase hype, and act fast.
- Favor tokens with strong buy/sell ratio, active trading, balanced holders, and upward momentum.
- Avoid whale-heavy, low-liquidity, or suspicious tokens.
- MEMECOINS are volatile — act fast but think smart.
- Apply **risk management**: protect capital, avoid chasing pumps, and prefer steady profit growth over reckless holds.
- Staying idle can be safer than a bad trade.

Trading rules:
- You may **only reference tokens by their numeric indexes** (from “Token index” or “Your portfolio”).
- Do **NOT** write or guess EVM addresses — use **numbers only**.
- buy(INDEX, AMOUNT_BNB) → buy or add to that token.  
- sell(INDEX) → sell **100%** of that token.
- You are **not required to trade every cycle** — if there are no strong opportunities, do nothing and explain why in the reason block.

Output format (strict, no extra text or JSON):
commands:
buy(INDEX, AMOUNT_BNB)
sell(INDEX)

reason: short explanation

Example:
commands:
buy(3, 0.25)
sell(7)
reason: token #3 shows strong momentum; token #7 losing volume

Example (no trades):
commands:
(reason: no strong candidates, low volume across all tokens)
`;


let commandHandlers = {
  buy: async (address, amount, ai) => await tradeBuy(address, amount, ai),
  sell: async (address, ai) => await tradeSell(address, ai),
};
export function setCommandHandlers(handlers = {}) {
  commandHandlers = { ...commandHandlers, ...handlers };
}

async function buildPortfolioBlock(ai, globalIdxMap, startIndex = 1) {
  try {
    const wallet = getAiWallet(ai);
    if (!wallet) return { text: `Your portfolio:\n(no wallet configured for ${ai})`, nextIndex: startIndex };

    const positions = await getPositions(wallet);
    const entries = positions && typeof positions === 'object' ? Object.entries(positions) : [];
    if (entries.length === 0) return { text: `Your portfolio:\n(empty)`, nextIndex: startIndex };

    const lines = ['Your portfolio:'];
    let n = startIndex;

    for (const [name, info] of entries) {
      if (name === 'BNB') {
        const amt = Number(info?.amount ?? 0);
        lines.push(`BNB — address=${info?.address}, balance=${amt} BNB`);
        continue;
      }
      const addr = info?.address ?? 'unknown';
      const bal = Number(info?.balance ?? 0);
      const pnl = Number(info?.PnL ?? 0);
      lines.push(`[${n}] ${name} — address=${addr}, balance=${bal} BNB, PnL=${pnl}%`);
      globalIdxMap.set(n, addr);
      n++;
    }

    return { text: lines.join('\n'), nextIndex: n };
  } catch (e) {
    return { text: `Your portfolio:\n(error fetching portfolio for ${ai}: ${e.message})`, nextIndex: startIndex };
  }
}
async function executeCommands(text, model, idxMap) {
  const commandsBlock = text.match(/commands:[\s\S]*?(?=reason:|$)/i);
  if (!commandsBlock) return { total: 0, settled: [] };

  const lines = commandsBlock[0]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.toLowerCase().startsWith('buy(') || l.toLowerCase().startsWith('sell('));

  const tasks = [];

  for (const line of lines) {
    try {
      if (line.toLowerCase().startsWith('buy(')) {
        const m = line.match(/buy\(\s*([^) ,]+)\s*,\s*([^)]+)\)/i);
        if (m) {
          const [, rawIndex, amount] = m;
          const addr = resolveAddress(rawIndex, idxMap);
          if (!addr || !isEvmAddress(addr)) { console.error(`⚠️ Skipping BUY: bad index/address "${rawIndex}"`); continue; }
          const amt = parseFloat(String(amount));
          if (!Number.isFinite(amt) || amt <= 0) { console.error(`⚠️ Skipping BUY: invalid amount "${amount}"`); continue; }
          tasks.push(commandHandlers.buy(addr, amt, model));
        }
      } else if (line.toLowerCase().startsWith('sell(')) {
        const m = line.match(/sell\(\s*([^)]+)\s*\)/i);
        if (m) {
          const [, rawIndex] = m;
          const addr = resolveAddress(rawIndex, idxMap);
          if (!addr || !isEvmAddress(addr)) { console.error(`⚠️ Skipping SELL: bad index/address "${rawIndex}"`); continue; }
          tasks.push(commandHandlers.sell(addr, model));
        }
      }
    } catch (e) {
      console.error('⚠️ Failed to parse command line:', line, e.message);
    }
  }

  const settled = await Promise.allSettled(tasks);
  return { total: tasks.length, settled };
}
async function queryModel(model, data) {
  const { idxMap, block: tokenIndexBlock, nextIndex } = buildIndexMapAndBlock(data, 1);
  const { text: portfolioBlock } = await buildPortfolioBlock(model, idxMap, nextIndex);

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_MESSAGE },
      {
        role: 'user',
        content:
          `Here is the token data (with indexes):\n${JSON.stringify(data, null, 2)}\n\n` +
          `${tokenIndexBlock}\n\n` +
          `${portfolioBlock}\n`,
      },
    ],
  };

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errText = await res.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = null; }
      const errMsg = errJson?.error?.message || res.statusText || `HTTP ${res.status}`;
      throw new Error(`${model} HTTP ${res.status} ${res.statusText} — ${errMsg}`);
    }

    const json = await res.json();
    const message = json?.choices?.[0]?.message?.content || '(empty response)';

    console.log(`\n🧠 Response from ${model}:\n${message}\n`);
    saveLog(model, message);

    
    const exec = await executeCommands(message, model, idxMap);
    console.log(`✔ ${model}: commands executed total=${exec.total}`);

    return { model, message, executed: exec };
  } catch (e) {
    console.error(`⚠️ Error querying ${model}:`, e.message);
    return { model, error: e.message };
  }
}
export async function sendToAllAIs(data) {
  const results = await Promise.all(MODELS.map((m) => queryModel(m, data)));
  return results;
}