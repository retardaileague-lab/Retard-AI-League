(() => {
  
  
  
const API = {
  TIMELINE: '/balanceTimeline',
  PNL_BY_WALLET: '/pnl/realized/by-wallet',
  REALIZED_EVENTS: '/pnl/realized/events', 
  ALL_REASONS: '/allTradesReasons',

};

function gmgnUrl(addr){ return `https://gmgn.ai/bsc/token/${addr}`; }
function escapeHTML(s){
  return String(s).replace(/[&<>"'`=\/]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
  }[c]));
}

const CACHES = {
  byWallet: null,
  timeline: null,
  winrateByWallet: {},        
  realizedEventsAll: null,    
   reasons: null,
};
  const MODEL_META = {
    'openai/gpt-5': {
      label: 'GPT-5',
      color: '#10b981',
      avatar: '/img/chat-gpt.png',
    },
    'anthropic/claude-sonnet-4.5': {
      label: 'Claude sonnet 4.5',
      color: '#ff6f3d',
      avatar: '/img/claude.png',
    },
    'deepseek/deepseek-chat-v3.1': {
      label: 'DeepSeek chat V3.1',
      color: '#2e86ff',
      avatar: '/img/deepseek.png',
    },
    'x-ai/grok-4': {
      label: 'Grok-4',
      color: '#111827',
      avatar: '/img/grok.png',
    },
    'google/gemini-2.5-pro': {
      label: 'Gemini 2.5 PRO',
      color: '#7c3aed',
      avatar: '/img/gemini.png',
    },
  };
const SIDEBAR_AVATAR = {
  'openai/gpt-5':         '/img/gpt-ai.gif',
  'anthropic/claude-sonnet-4.5':'/img/claude-ai.gif',
  'deepseek/deepseek-chat-v3.1':'/img/deep-ai.gif',
  'x-ai/grok-4':          '/img/grok-ai.gif',
  'google/gemini-2.5-pro':   '/img/gemini-ai.gif',
};
  const MODELS = [
    'openai/gpt-5',
    'anthropic/claude-sonnet-4.5',
    'deepseek/deepseek-chat-v3.1',
    'x-ai/grok-4',
    'google/gemini-2.5-pro',
  ];

  const WALLETS = {
    'openai/gpt-5':         '0x645AB91bE1e004A70C0af80e0238176C1aEA4217',
    'x-ai/grok-4':          '0x52f7D953A936FBe2C171385475BfC881935595d0',
    'anthropic/claude-sonnet-4.5':'0xbDe0B5f5192e19E55dF29612D14036af7A8e04A8',
    'deepseek/deepseek-chat-v3.1':'0x59263161D3801d22564733C48EdFF68e38316994',
    'google/gemini-2.5-pro':   '0x39443fBfA6EF376B16121905122f2A4e4b3A48F2',
  };

  
  const WALLET_TO_MODEL = (() => {
    const m = new Map();
    for (const [model, addr] of Object.entries(WALLETS)) {
      if (addr) m.set(addr.toLowerCase(), model);
    }
    return m;
  })();

  
  
  
  const BEST_EL  = document.getElementById('best-ai');
  const WORST_EL = document.getElementById('worst-ai');
  const container = document.querySelector('.chart-placeholder');
  const TRADE_FEED_EL = document.getElementById('trade-feed');
  const MODELS_LIST = document.getElementById('models-list');

  
  
  
  const fetchJSON = async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };

  const shortAddr = (addr) => {
    const s = String(addr || '');
    return /^0x[a-fA-F0-9]{40}$/.test(s) ? `${s.slice(0,6)}…${s.slice(-4)}` : s;
  };

  const fmtFixed = (v, n = 2) => Number.isFinite(+v) ? (+v).toFixed(n) : '—';
  const fmtBNB = (v, n = 2) => Number.isFinite(+v) ? `${(+v).toFixed(n)} BNB` : '—';
  const fmtPct = (v, n = 2) => Number.isFinite(+v) ? `${(+v).toFixed(n)}%` : '—';

  const modelColor = (name) => MODEL_META[name]?.color || '#334155';
  const modelLabel = (name) => MODEL_META[name]?.label || name;

  
  
  
  const MODEL_NODES = new Map(); 
async function computeWalletWinrate(walletAddr){
  const key = String(walletAddr || '').toLowerCase();
  if (key in CACHES.winrateByWallet) return CACHES.winrateByWallet[key];

  
  try{
    const url = `${API.REALIZED_EVENTS}?wallet=${encodeURIComponent(key)}`;
    const events = await fetchJSON(url); 
    let wins = 0, losses = 0; 
    for (const ev of events || []) {
      const v = Number(ev?.pnl_bnb);
      if (!Number.isFinite(v)) continue;
      if (v > 0) wins++;
      else if (v < 0) losses++;
    }
    const denom = wins + losses;
    if (denom > 0) {
      const wr = (wins / denom) * 100;
      CACHES.winrateByWallet[key] = wr;
      return wr;
    }
  } catch(e){
    console.error('computeWalletWinrate(events) error:', e);
  }

  
  try{
    const byWallet = CACHES.byWallet || await fetchJSON(API.PNL_BY_WALLET);
    if (!CACHES.byWallet) CACHES.byWallet = byWallet;

    const row = byWallet[key] || byWallet[walletAddr] || null;
    if (row && Number.isFinite(+row.pnl_bnb)) {
      
      const wr = (+row.pnl_bnb > 0) ? 100 : 0;
      CACHES.winrateByWallet[key] = wr;
      return wr;
    }
  } catch(e){
    console.error('computeWalletWinrate(fallback) error:', e);
  }

  
  CACHES.winrateByWallet[key] = null;
  return null;
}
  function renderModelCards() {
    if (!MODELS_LIST) return;
    MODELS_LIST.innerHTML = '';

    for (const key of MODELS) {
      const meta = MODEL_META[key] || {};
      const name = meta.label || key;
      const color = meta.color || '#cbd5e1';
      const addr  = WALLETS[key] || null;

      const card = document.createElement('div');
      card.className = 'model-card';
      card.addEventListener('click', () => openModelModal(key));
      const avatar = document.createElement('div');
      avatar.className = 'model-avatar';
      avatar.style.borderColor = color;
      const sideImg = SIDEBAR_AVATAR[key] || meta.avatar;
if (sideImg) {
  avatar.style.backgroundImage = `url(${sideImg})`;
  avatar.style.backgroundSize = 'cover';
  avatar.style.backgroundPosition = 'center';
  avatar.style.backgroundRepeat = 'no-repeat';
}
      const info = document.createElement('div');
      info.className = 'model-info';

      const header = document.createElement('div');
      header.className = 'model-header';

      const title = document.createElement('div');
      title.className = 'model-name';
      title.textContent = name;

      const pnl = document.createElement('div');
      pnl.className = 'model-pnl';
      pnl.textContent = 'PnL: — BNB / —%';

      const wallet = document.createElement('div');
      wallet.className = 'model-wallet';
      if (addr) {
        const a = document.createElement('a');
        a.href = `https://bscscan.com/address/${addr}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = shortAddr(addr);
        wallet.innerHTML = 'Wallet: ';
        wallet.appendChild(a);
      } else {
        wallet.textContent = 'Wallet: —';
      }

      header.appendChild(title);
      header.appendChild(pnl);
      info.appendChild(header);
      info.appendChild(wallet);

      card.appendChild(avatar);
      card.appendChild(info);
      MODELS_LIST.appendChild(card);

      MODEL_NODES.set(key, { card, pnlEl: pnl, avatarEl: avatar });
      let popover = null;
let hoverInside = false;
card.addEventListener('mouseenter', (e) => {
  hoverInside = true;
  const { clientX, clientY } = e;
  if (popover) { popover.remove(); popover = null; }
  popover = showModelPopover(card, key, clientX, clientY);
});
card.addEventListener('mousemove', (e) => {
  if (!hoverInside) return;
  if (!popover) popover = showModelPopover(card, key, e.clientX, e.clientY);
  else {
    
    const pad = 12;
    let x = e.clientX + pad, y = e.clientY + pad;
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = popover.getBoundingClientRect();
    if (x + r.width > vw - 8)  x = vw - r.width - 8;
    if (y + r.height > vh - 8) y = vh - r.height - 8;
    if (x < 8) x = 8; if (y < 8) y = 8;
    popover.style.left = x + 'px';
    popover.style.top  = y + 'px';
  }
});
card.addEventListener('mouseleave', () => {
  hoverInside = false;
  if (popover) { popover.remove(); popover = null; }
});
    }
  }

  async function refreshCardsPnl() {
    try {
      const byWallet = await fetchJSON(API.PNL_BY_WALLET); 
      CACHES.byWallet = byWallet;
      for (const [model, addr] of Object.entries(WALLETS)) {
        const node = MODEL_NODES.get(model);
        if (!node) continue;
        const keyLc = String(addr || '').toLowerCase();
        const row = byWallet[keyLc] || byWallet[addr] || null;
        let invested = 0, sold = 0, pnl = 0, pct = 0;

        if (row) {
          invested = Number(row.invested_bnb) || 0;
          sold     = Number(row.sold_bnb) || 0;
          pnl      = Number.isFinite(+row.pnl_bnb) ? +row.pnl_bnb : (sold - invested);
          pct      = Number.isFinite(+row.pnl_pct) ? +row.pnl_pct : (invested !== 0 ? (pnl / invested) * 100 : 0);
        }

        node.pnlEl.textContent = `PnL: ${fmtFixed(pnl,2)} BNB / ${fmtFixed(pct,2)}%`;
        node.pnlEl.style.color = pnl > 0 ? '#16a34a' : pnl < 0 ? '#dc2626' : 'var(--text)';
      }
    } catch (e) {
      console.error('refreshCardsPnl error:', e);
    }
  }

  
  
  
  function normalizeEvent(ev){
    const wallet = (ev.wallet || ev.addr || ev.address || '').toString();
    const token  = ev.token || ev.tokenAddress || ev.symbol || ev.sym || '';
    const buyBNB  = ev.buy_bnb ?? ev.in_bnb ?? ev.invested_bnb ?? ev.cost_bnb ?? ev.buy;
    const sellBNB = ev.sell_bnb ?? ev.out_bnb ?? ev.sold_bnb ?? ev.proceeds_bnb ?? ev.sell;
    const pnlBNB  = ev.pnl_bnb ?? (Number.isFinite(+buyBNB)&&Number.isFinite(+sellBNB) ? (+sellBNB - +buyBNB) : undefined);
    const pnlPct  = ev.pnl_pct ?? (Number.isFinite(+pnlBNB)&&Number.isFinite(+buyBNB)&&+buyBNB!==0 ? (+pnlBNB/+buyBNB)*100 : undefined);
    const side = (ev.side || ev.action || 'buy').toString().toLowerCase();
    return {
      model: ev.model, wallet, token,
      buyBNB:  Number.isFinite(+buyBNB)  ? +buyBNB  : null,
      sellBNB: Number.isFinite(+sellBNB) ? +sellBNB : null,
      pnlBNB:  Number.isFinite(+pnlBNB)  ? +pnlBNB  : null,
      pnlPct:  Number.isFinite(+pnlPct)  ? +pnlPct  : null,
      side: (side==='buy' || side==='sell') ? side : 'buy',
      tSort: Date.parse(ev.time_close || ev.close_time || ev.closed_at || ev.time || 0) || 0,
    };
  }


  
  
  
  
  const canvas = document.createElement('canvas');
  canvas.id = 'timeline-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: true });
  canvas.style.imageRendering = 'auto';
  canvas.style.transform = '';
  canvas.style.backfaceVisibility = '';

  const tooltip = document.createElement('div');
  tooltip.style.position = 'absolute';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.padding = '8px 10px';
  tooltip.style.border = '1px solid rgba(15,23,42,0.12)';
  tooltip.style.borderRadius = '10px';
  tooltip.style.background = '#fff';
  tooltip.style.boxShadow = '0 10px 24px rgba(15,23,42,0.08)';
  tooltip.style.font = '12px "JetBrains Mono", monospace';
  tooltip.style.color = '#0f172a';
  tooltip.style.whiteSpace = 'nowrap';
  tooltip.style.left = '-9999px';
  tooltip.style.top  = '-9999px';
  tooltip.style.zIndex = '999';
  container.style.position = 'relative';
  container.appendChild(tooltip);

  
  let DPR = 1;
  const state = { lastRaw: null, lastSeries: null, lastBounds: null, active: null, raf: 0 };

  
  const fades = new Map(); 
  const FADE_ON  = 0.98;
  const FADE_OFF = 0.22;
  const FADE_EASE = 0.18;
  const ensureFade = (model) => {
    if (!fades.has(model)) fades.set(model, { cur: FADE_OFF, target: FADE_OFF });
    return fades.get(model);
  };
  const setFadeTargets = (activeModel) => {
    for (const s of (state.lastSeries || [])) {
      const f = ensureFade(s.model);
      f.target = activeModel && s.model === activeModel ? FADE_ON : FADE_OFF;
    }
  };
  const stepFades = () => {
    let moving = false;
    for (const f of fades.values()) {
      const next = f.cur + (f.target - f.cur) * FADE_EASE;
      if (Math.abs(next - f.cur) > 0.003) moving = true;
      f.cur = next;
    }
    return moving;
  };

  
  const canvasCSSSize = () => ({ W: canvas.width / DPR, H: canvas.height / DPR });

  function resizeCanvas() {
    DPR = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width  = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (state.lastRaw) render(state.lastRaw);
  });

  
  const fmtTimeHM = (t) => {
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  };
  const fmtVal = (v) => `${Number(v).toFixed(3)} BNB`;

  
  function parseTimeline(raw) {
    const series = [];
    for (const [model, arr] of Object.entries(raw || {})) {
      const pts = (arr || [])
        .map(d => {
          const t0 = new Date(d.time).getTime();
          if (!Number.isFinite(t0)) return null;
          const rounded = Math.round(t0 / 60000) * 60000; 
          const v = Number.isFinite(+d.balance) ? +d.balance : null;
          return { t: rounded, v };
        })
        .filter(Boolean)
        .sort((a, b) => a.t - b.t);

      if (!pts.length) continue;

      
      const merged = [];
      for (const p of pts) {
        const last = merged[merged.length - 1];
        if (last && last.t === p.t) last.v = p.v ?? last.v;
        else merged.push(p);
      }
      series.push({ model, points: merged, color: modelColor(model) });
    }
    return series;
  }

  
  function getBounds(series) {
    let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (Number.isFinite(p.t)) {
          tMin = Math.min(tMin, p.t);
          tMax = Math.max(tMax, p.t);
        }
        if (p.v != null) {
          vMin = Math.min(vMin, p.v);
          vMax = Math.max(vMax, p.v);
        }
      }
    }
    if (!isFinite(tMin) || !isFinite(tMax)) {
      const now = Date.now();
      tMin = now - 60_000; tMax = now;
    }
    if (!isFinite(vMin) || !isFinite(vMax)) { vMin = 0; vMax = 1; }
    if (vMax === vMin) { const pad = Math.max(1, Math.abs(vMax) * 0.02); vMax += pad; vMin -= pad; }

    
    const spanT = Math.max(60_000, tMax - tMin);
    const padT = Math.max(60_000, Math.round((spanT * 0.05) / 60_000) * 60_000);
    tMax += padT;

    const padV = (vMax - vMin) * 0.03;
    return { tMin, tMax, vMin: vMin - padV, vMax: vMax + padV };
  }

  
  const PADDING = { l: 64, r: 24, t: 12, b: 42 };
  const crisp = (x) => Math.round(x) + 0.5;

  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    let nf;
    if (round)      nf = (f < 1.5) ? 1 : (f < 3) ? 2 : (f < 7) ? 5 : 10;
    else            nf = (f <= 1)  ? 1 : (f <= 2) ? 2 : (f <= 5) ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  function makeYTicks(min, max, maxTicks = 6) {
    const range = niceNum(max - min, false);
    const step  = niceNum(range / (maxTicks - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + 1e-12; v += step) ticks.push(+v.toFixed(12));
    return { ticks, step, min: niceMin, max: niceMax };
  }

  const TIME_STEPS_MIN = [1,2,5,10,15,30,60,120,180,240,360];
  function makeTimeTicks(tMin, tMax, maxTicks = 8) {
    const spanMin = (tMax - tMin) / 60000;
    let stepMin = TIME_STEPS_MIN[0];
    for (const s of TIME_STEPS_MIN) { if (spanMin / s <= maxTicks) { stepMin = s; break; } stepMin = s; }
    const stepMs = stepMin * 60_000;
    const start  = Math.ceil(tMin / stepMs) * stepMs;
    const ticks = [];
    for (let t = start; t <= tMax + 1e-9; t += stepMs) ticks.push(t);
    if (!ticks.length) ticks.push(Math.round(tMax / 60000) * 60000);
    return { ticks, stepMs };
  }

  
  function drawAxesGrid(bounds) {
    const { W, H } = canvasCSSSize();
    const innerW = W - PADDING.l - PADDING.r;
    const innerH = H - PADDING.t - PADDING.b;

    ctx.clearRect(0, 0, W, H);

    const { tMin, tMax, vMin, vMax } = bounds;
    const yInfo = makeYTicks(vMin, vMax, 6);
    const xInfo = makeTimeTicks(tMin, tMax, 8);

    const X = (t) => PADDING.l + ((t - tMin) / (tMax - tMin)) * innerW;
    const Y = (v) => H - PADDING.b - ((v - yInfo.min) / (yInfo.max - yInfo.min)) * innerH;

    
    ctx.save();
    ctx.strokeStyle = '#cfcfcf';
    ctx.lineWidth = 1;

    
    for (const v of yInfo.ticks) {
      const y = crisp(Y(v));
      if (y < PADDING.t - 1 || y > H - PADDING.b + 1) continue;
      ctx.beginPath();
      ctx.moveTo(crisp(PADDING.l), y);
      ctx.lineTo(crisp(W - PADDING.r), y);
      ctx.stroke();
    }

    
    for (const t of xInfo.ticks) {
      const x = crisp(X(t));
      if (x < PADDING.l - 1 || x > W - PADDING.r + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, crisp(PADDING.t));
      ctx.lineTo(x, crisp(H - PADDING.b));
      ctx.stroke();
    }

    
    ctx.beginPath();
    ctx.moveTo(crisp(PADDING.l), crisp(PADDING.t));
    ctx.lineTo(crisp(PADDING.l), crisp(H - PADDING.b));
    ctx.moveTo(crisp(PADDING.l), crisp(H - PADDING.b));
    ctx.lineTo(crisp(W - PADDING.r), crisp(H - PADDING.b));
    ctx.stroke();
    ctx.restore();

    
    ctx.fillStyle = '#64748b';
    ctx.font = '12px "JetBrains Mono", monospace';

    
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of yInfo.ticks) {
      const y = Y(v);
      if (y < PADDING.t - 1 || y > H - PADDING.b + 1) continue;
      ctx.fillText(`${v}`, PADDING.l - 10, y);
    }

    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const t of xInfo.ticks) {
      const x = X(t);
      if (x < PADDING.l - 1 || x > W - PADDING.r + 1) continue;
      ctx.fillText(fmtTimeHM(t), x, H - 10);
    }

    
    ctx.save();
    ctx.strokeStyle = 'rgba(15,23,42,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(crisp(PADDING.l), crisp(PADDING.t), innerW - 1, innerH - 1);
    ctx.restore();

    return { X, Y, yMin: yInfo.min, yMax: yInfo.max };
  }

  
  const avatarCache = new Map(); 
  function getAvatar(model) {
    if (avatarCache.has(model)) return avatarCache.get(model);
    const url = MODEL_META[model]?.avatar;
    if (!url) { avatarCache.set(model, null); return null; }
    const img = new Image();
    avatarCache.set(model, 'loading');
    img.onload  = () => avatarCache.set(model, img);
    img.onerror = () => avatarCache.set(model, null);
    img.src = url;
    return 'loading';
  }
  
  (function preloadAvatars(){
    for (const k of MODELS) getAvatar(k);
  })();

  
  function renderLines(series, converters, active) {
    const { W, H } = canvasCSSSize();
    const innerW = W - PADDING.l - PADDING.r;
    const innerH = H - PADDING.t - PADDING.b;
    const { X, Y } = converters;

    
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADDING.l - 1, PADDING.t - 1, innerW + 2, innerH + 2);
    ctx.clip();

    for (const s of series) {
      const isActive = active && active.series === s;
      const f = ensureFade(s.model);

      
      ctx.save();
      ctx.lineJoin = 'miter';
      ctx.lineCap  = 'butt';
      ctx.lineWidth = isActive ? 3.2 : 2.8;
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = f.cur;

      ctx.beginPath();
      let moved = false;
      for (const p of s.points) {
        if (p.v == null) { moved = false; continue; }
        const x = X(p.t), y = Y(p.v);
        if (!moved) { ctx.moveTo(x, y); moved = true; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.restore();

      
      for (let i = s.points.length - 1; i >= 0; i--) {
        const p = s.points[i];
        if (p.v == null) continue;
        const x = X(p.t), y = Y(p.v);

        const avatar = getAvatar(s.model);
        const R = 18, STROKE = 3;

        ctx.save();
        
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, R + STROKE, 0, Math.PI * 2);
        ctx.fill();

        if (avatar && avatar !== 'loading') {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.clip();
          const scale = 0.8;
          const size = R * 2 * scale;
          ctx.drawImage(avatar, x - size/2, y - size/2, size, size);
          ctx.restore();
        } else {
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.strokeStyle = s.color;
        ctx.lineWidth = STROKE;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }

      
      if (isActive && active.point) {
        const { x, y } = active.point;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(x, y, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    
    if (active) {
      ctx.save();
      ctx.strokeStyle = 'rgba(15,23,42,0.20)';
      ctx.setLineDash([4, 5]);
      const cx = crisp(active.x);
      ctx.beginPath();
      ctx.moveTo(cx, PADDING.t);
      ctx.lineTo(cx, H - PADDING.b);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); 
  }

  
  function binarySearchNearest(points, t) {
    let lo = 0, hi = points.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid + 1; else hi = mid - 1;
    }
    const c = [];
    if (lo < points.length) c.push(points[lo]);
    if (lo - 1 >= 0) c.push(points[lo - 1]);
    const valid = c.filter(p => p && p.v != null);
    if (!valid.length) return null;
    valid.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t));
    return valid[0];
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function screenToTime(x) {
    const { W } = canvasCSSSize();
    const innerW = W - PADDING.l - PADDING.r;
    const { tMin, tMax } = state.lastBounds;
    const ratio = clamp((x - PADDING.l) / innerW, 0, 1);
    return tMin + ratio * (tMax - tMin);
  }
  function timeToX(t) {
    const { W } = canvasCSSSize();
    const innerW = W - PADDING.l - PADDING.r;
    const { tMin, tMax } = state.lastBounds;
    return PADDING.l + ((t - tMin) / (tMax - tMin)) * innerW;
  }
  function valToY(v, yMin, yMax) {
    const { H } = canvasCSSSize();
    const innerH = H - PADDING.t - PADDING.b;
    return (v == null) ? null : (H - PADDING.b - ((v - yMin) / (yMax - yMin)) * innerH);
  }

  function placeTooltip(px, py, html) {
    tooltip.innerHTML = html;

    const contRect = container.getBoundingClientRect();
    const canvRect = canvas.getBoundingClientRect();

    let x = Math.round(px + (canvRect.left - contRect.left) + 12);
    let y = Math.round(py + (canvRect.top  - contRect.top)  - 12);

    
    tooltip.style.left = `${x}px`;
    tooltip.style.top  = `${y}px`;

    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const maxX = contRect.width - 8;
    const maxY = contRect.height - 8;

    if (x + tw > maxX) x = x - tw - 24;
    if (x < 8) x = 8;
    if (y - th < 8) y = y + th + 24;
    if (y > maxY - 8) y = maxY - 8;

    tooltip.style.left = `${x}px`;
    tooltip.style.top  = `${y - th}px`;
  }

  function handlePointer(clientX, clientY) {
    if (!state.lastSeries || !state.lastSeries.length) return;

    const rect = canvas.getBoundingClientRect();
    let x = clientX - rect.left;
    let y = clientY - rect.top;

    
    const { W } = canvasCSSSize();
    x = clamp(x, PADDING.l, W - PADDING.r);

    
    const tRaw = screenToTime(x);
    const tRounded = Math.round(tRaw / 60000) * 60000;

    let best = null;
    for (const s of state.lastSeries) {
      const near = binarySearchNearest(s.points, tRounded);
      if (!near || near.v == null) continue;
      const px = timeToX(near.t);
      const py = valToY(near.v, state._yMin, state._yMax);
      const dist = Math.hypot(px - x, py - y);
      if (!best || dist < best.dist) best = { series: s, px, py, t: near.t, v: near.v, dist };
    }

    if (!best) {
      state.active = null;
      tooltip.style.left = '-9999px';
      tooltip.style.top  = '-9999px';
      render(state.lastRaw);
      return;
    }

    state.active = {
      x: timeToX(best.t),
      point: { x: best.px, y: best.py },
      series: best.series,
      v: best.v,
      t: best.t
    };
    setFadeTargets(state.active.series.model);

    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(() => {
      render(state.lastRaw);
      placeTooltip(state.active.point.x, state.active.point.y,
        `<b>${modelLabel(best.series.model)}</b><br>${fmtTimeHM(best.t)} · ${fmtVal(best.v)}`
      );
    });
  }

  function onMove(e) { handlePointer(e.clientX, e.clientY); }
  function onTouch(e) { const t = e.touches && e.touches[0]; if (t) handlePointer(t.clientX, t.clientY); }
  function onLeave() {
    state.active = null;
    tooltip.style.left = '-9999px';
    tooltip.style.top  = '-9999px';
    setFadeTargets(null);
    render(state.lastRaw);
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('touchstart', onTouch, { passive: true });
  canvas.addEventListener('touchmove', onTouch, { passive: true });
  canvas.addEventListener('touchend', onLeave);

  
  function updateBestWorst(series) {
    const latest = [];
    for (const s of series) {
      for (let i = s.points.length - 1; i >= 0; i--) {
        const p = s.points[i];
        if (p.v != null) { latest.push({ model: s.model, value: p.v }); break; }
      }
    }
    if (!latest.length) { if (BEST_EL) BEST_EL.textContent = '—'; if (WORST_EL) WORST_EL.textContent = '—'; return; }
    latest.sort((a, b) => b.value - a.value);
    if (BEST_EL)  BEST_EL.textContent  = modelLabel(latest[0].model);
    if (WORST_EL) WORST_EL.textContent = modelLabel(latest[latest.length - 1].model);
  }

  
  function render(raw) {
    state.lastRaw    = raw;
    state.lastSeries = parseTimeline(raw);
    state.lastBounds = getBounds(state.lastSeries);

    resizeCanvas();

    const converters = drawAxesGrid(state.lastBounds);
    state._yMin = converters.yMin;
    state._yMax = converters.yMax;

    renderLines(state.lastSeries, converters, state.active);
    updateBestWorst(state.lastSeries);
    setFadeTargets(state.active ? state.active.series.model : null);

    if (stepFades()) {
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(() => render(state.lastRaw));
    }
  }

  
  async function fetchTimeline() {
    const data = await fetchJSON(API.TIMELINE);
    return data;
  }
  async function tick() {
    try {
        const data = await fetchTimeline();
        CACHES.timeline = data;     
        render(data);
    } catch (e) {
      console.error('timeline fetch/render failed:', e);
    }
  }
function getModelTimelinePoints(modelKey) {
  const raw = CACHES.timeline || null;
  if (!raw) return [];
  const arr = raw[modelKey] || [];
  
  const last = arr.slice(Math.max(0, arr.length - 80));
  const pts = last
    .map(d => {
      const t = new Date(d.time).getTime();
      if (!Number.isFinite(t)) return null;
      const v = Number.isFinite(+d.balance) ? +d.balance : null;
      return v == null ? null : { t, v };
    })
    .filter(Boolean);
  return pts;
}
function formatBNB(v){ return Number.isFinite(+v) ? (+v).toFixed(2)+' BNB' : '—'; }
function formatPct(v){ return Number.isFinite(+v) ? (+v).toFixed(2)+'%'   : '—'; }

function getWalletRowForModel(modelKey){
  const addr = WALLETS[modelKey];
  if (!addr || !CACHES.byWallet) return null;
  const keyLc = String(addr).toLowerCase();
  return CACHES.byWallet[keyLc] || CACHES.byWallet[addr] || null;
}

function createModelPopover(modelKey) {
  const meta = MODEL_META[modelKey] || {};
  const color = meta.color || '#334155';

  const el = document.createElement('div');
  el.className = 'model-popover';
  el.style.position = 'fixed';
  el.style.zIndex = '9999';
  el.style.minWidth = '220px';
  el.style.maxWidth = '260px';
  el.style.padding = '10px 12px';
  el.style.border = '1px solid rgba(15,23,42,0.12)';
  el.style.borderRadius = '12px';
  el.style.background = '#fff';
  el.style.boxShadow = '0 12px 28px rgba(15,23,42,0.12)';
  el.style.font = '12px "JetBrains Mono", monospace';
  el.style.color = '#0f172a';
  el.style.pointerEvents = 'none'; 

  
  const row = getWalletRowForModel(modelKey);
  const pnlBNB = row?.pnl_bnb ?? null;
  const pnlPct = row?.pnl_pct ?? (row && row.invested_bnb ? (row.pnl_bnb/row.invested_bnb)*100 : null);

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.marginBottom = '6px';
  title.textContent = modelLabel(modelKey);

  const stats = document.createElement('div');
  stats.style.display = 'grid';
  stats.style.gridTemplateColumns = 'auto auto';
  stats.style.gap = '6px 10px';
  stats.style.marginBottom = '8px';

  const s1a = document.createElement('div'); s1a.textContent = 'PnL:';
  const s1b = document.createElement('div'); s1b.textContent = formatBNB(pnlBNB);
  const s2a = document.createElement('div'); s2a.textContent = 'ROI:';
  const s2b = document.createElement('div'); s2b.textContent = formatPct(pnlPct);

  const s3a = document.createElement('div'); s3a.textContent = 'Winrate:';
  const s3b = document.createElement('div'); s3b.textContent = '…';

  
  if (Number(pnlBNB) > 0)  s1b.style.color = '#16a34a';
  if (Number(pnlBNB) < 0)  s1b.style.color = '#dc2626';
  if (Number(pnlPct) > 0)  s2b.style.color = '#16a34a';
  if (Number(pnlPct) < 0)  s2b.style.color = '#dc2626';

  
  stats.append(s1a,s1b,s2a,s2b, s3a,s3b);

  const canvasMini = document.createElement('canvas');
  canvasMini.width = 160; canvasMini.height = 44;
  canvasMini.style.display = 'block';
  canvasMini.style.margin = '6px 0 2px';
  canvasMini.style.width = '100%';
  canvasMini.style.height = '44px';

  el.appendChild(title);
  el.appendChild(stats);
  el.appendChild(canvasMini);

  
  const pts = getModelTimelinePoints(modelKey);
  drawSparkline(canvasMini, pts, color);
  const addr = WALLETS[modelKey];
  if (addr) {
    computeWalletWinrate(addr).then((wr) => {
      if (wr == null) {
        s3b.textContent = '—';
        s3b.style.color = '#0f172a';
      } else {
        s3b.textContent = formatPct(wr);
        
        s3b.style.color = wr >= 50 ? '#16a34a' : '#dc2626';
      }
    }).catch(() => {
      s3b.textContent = '—';
      s3b.style.color = '#0f172a';
    });
  } else {
    s3b.textContent = '—';
  }
  return el;
}

function showModelPopover(cardEl, modelKey, clientX, clientY) {
  const pop = createModelPopover(modelKey);
  document.body.appendChild(pop);

  
  const pad = 12;
  let x = clientX + pad;
  let y = clientY + pad;

  const vw = window.innerWidth, vh = window.innerHeight;
  const r = pop.getBoundingClientRect();
  if (x + r.width > vw - 8)  x = vw - r.width - 8;
  if (y + r.height > vh - 8) y = vh - r.height - 8;
  if (x < 8) x = 8; if (y < 8) y = 8;

  pop.style.left = x + 'px';
  pop.style.top  = y + 'px';

  return pop;
}


async function fetchAllReasonsOnce(){
  if (CACHES.reasons) return CACHES.reasons;
  try{
    const r = await fetchJSON(API.ALL_REASONS);
    CACHES.reasons = r || {};
  } catch(e){
    console.error('allReasons fetch error', e);
    CACHES.reasons = {};
  }
  return CACHES.reasons;
}
function renderModalChart(canvas, points, color = '#0ea5e9') {
 
  const cssW = Math.max(1, Math.floor(canvas.clientWidth || 860));
  const cssH = Math.max(1, Math.floor(canvas.clientHeight || 160));

 
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = cssW * DPR;
  canvas.height = cssH * DPR;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = true;

 
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cssW, cssH);

 
  const PAD = { l: 64, r: 14, t: 12, b: 28 };
  const innerW = Math.max(1, cssW - PAD.l - PAD.r);
  const innerH = Math.max(1, cssH - PAD.t - PAD.b);

  if (!points || !points.length) {
    ctx.strokeStyle = 'rgba(15,23,42,0.12)';
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t + innerH / 2);
    ctx.lineTo(cssW - PAD.r, PAD.t + innerH / 2);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('BNB', 10, PAD.t + 12);
    return;
  }

  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);
  const tMin = Math.min(...xs);
  const tMax = Math.max(...xs);
  let vMin = Math.min(...ys);
  let vMax = Math.max(...ys);
  if (vMax === vMin) { const d = Math.max(1, Math.abs(vMax)*0.02); vMax += d; vMin -= d; }

  const yInfo = makeYTicks(vMin, vMax, 6);
  const X = (t) => PAD.l + ((t - tMin) / (tMax - tMin || 1)) * innerW;
  const Y = (v) => PAD.t + (1 - (v - yInfo.min) / (yInfo.max - yInfo.min || 1)) * innerH;
  const crisp = (x) => Math.round(x) + 0.5;

 
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  for (const v of yInfo.ticks) {
    const y = crisp(Y(v));
    ctx.beginPath();
    ctx.moveTo(crisp(PAD.l), y);
    ctx.lineTo(crisp(cssW - PAD.r), y);
    ctx.stroke();
  }

 
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(crisp(PAD.l), crisp(PAD.t));
  ctx.lineTo(crisp(PAD.l), crisp(cssH - PAD.b));
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yInfo.ticks) {
    ctx.fillText(`${(+v).toFixed(2)}`, PAD.l - 10, Y(v));
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('BNB', 10, PAD.t + 12);

 
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.l, PAD.t, innerW, innerH);
  ctx.clip();

 
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = X(p.t), y = Y(p.v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

 
  const last = points[points.length - 1];
  const lx = X(last.t), ly = Y(last.v);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  const label = `${last.v.toFixed(3)} BNB`;
  const labelPadX = 6;
  ctx.font = '12px "JetBrains Mono", monospace';
  const tw = ctx.measureText(label).width;
  const bx = Math.min(cssW - PAD.r - tw - labelPadX * 2, Math.max(PAD.l, lx + 8));
  const by = Math.max(PAD.t + 4, Math.min(cssH - PAD.b - 22, ly - 10));
  ctx.fillStyle = '#0f172a';
  ctx.globalAlpha = 0.08;
  ctx.fillRect(bx, by, tw + labelPadX * 2, 20);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f172a';
  ctx.fillText(label, bx + labelPadX, by + 14);

  ctx.restore();
}
function formatTimeFull(ts){
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth()+1).padStart(2,'0');
  const DD = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${yyyy}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

function signClassNum(v){
  return Number(v)>0 ? 'positive' : Number(v)<0 ? 'negative' : '';
}

function drawSparkline(canvas, points, color = '#0ea5e9') {
  const w = 160, h = 44, padX = 6, padY = 6;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);

  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,w,h);

  if (!points.length) {
    
    ctx.strokeStyle = 'rgba(15,23,42,0.12)';
    ctx.beginPath();
    ctx.moveTo(padX, h/2); ctx.lineTo(w-padX, h/2);
    ctx.stroke();
    return;
  }

  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (maxY === minY) { const d = Math.max(1, Math.abs(maxY)*0.02); maxY+=d; minY-=d; }

  const X = (t) => padX + ((t - minX) / (maxX - minX || 1)) * (w - padX*2);
  const Y = (v) => padY + (1 - (v - minY) / (maxY - minY || 1)) * (h - padY*2);

  
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = X(p.t), y = Y(p.v);
    if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  
  const last = points[points.length-1];
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(X(last.t), Y(last.v), 3.2, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
}

async function fetchAllRealizedEventsOnce() {
  if (Array.isArray(CACHES.realizedEventsAll)) return CACHES.realizedEventsAll;
  const arr = await fetchJSON(API.REALIZED_EVENTS); 
  CACHES.realizedEventsAll = Array.isArray(arr) ? arr : [];
  return CACHES.realizedEventsAll;
}


function buildWinratesFromEvents(events) {
  const res = {}; 
  const byWallet = new Map();

  for (const ev of events) {
    const w = String(ev?.wallet || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(w)) continue;
    if (!byWallet.has(w)) byWallet.set(w, { wins: 0, losses: 0 });
    const v = Number(ev?.pnl_bnb);
    if (!Number.isFinite(v)) continue;
    if (v > 0) byWallet.get(w).wins++;
    else if (v < 0) byWallet.get(w).losses++;
    
  }

  for (const [w, { wins, losses }] of byWallet.entries()) {
    const denom = wins + losses;
    res[w] = denom > 0 ? (wins / denom) * 100 : null;
  }
  return res;
}


async function computeWalletWinrate(walletAddr) {
  const key = String(walletAddr || '').toLowerCase();
  if (key in CACHES.winrateByWallet) return CACHES.winrateByWallet[key];

  try {
    const events = await fetchAllRealizedEventsOnce(); 
    const map = buildWinratesFromEvents(events);
    Object.assign(CACHES.winrateByWallet, map); 

    
    if (!(key in CACHES.winrateByWallet)) {
      const byWallet = CACHES.byWallet || await fetchJSON(API.PNL_BY_WALLET);
      if (!CACHES.byWallet) CACHES.byWallet = byWallet;
      const row = byWallet[key] || byWallet[walletAddr] || null;
      if (row && Number.isFinite(+row.pnl_bnb)) {
        CACHES.winrateByWallet[key] = (+row.pnl_bnb > 0) ? 100 : 0;
      } else {
        CACHES.winrateByWallet[key] = null;
      }
    }
    return CACHES.winrateByWallet[key];
  } catch (e) {
    console.error('computeWalletWinrate error:', e);
    CACHES.winrateByWallet[key] = null;
    return null;
  }
}

  
  
  
  renderModelCards();
  resizeCanvas();
  tick();
  setInterval(tick, 10_000);
async function refreshWinrates() {
  try {
    const events = await fetchAllRealizedEventsOnce();           
    const map = buildWinratesFromEvents(events);                  
    CACHES.winrateByWallet = map;
  } catch (e) {
    console.error('refreshWinrates error:', e);
  }
}

const API_ACTIONS = '/actions/derived';


function symbolFromToken(addr){
  
  
  const s = String(addr || '');
  return /^0x[a-fA-F0-9]{40}$/.test(s) ? shortAddr(s) : s;
}

function signClass(v){ return Number(v) > 0 ? 'positive' : Number(v) < 0 ? 'negative' : ''; }
function fmtPctSigned(v){ return Number.isFinite(+v) ? `${(+v>=0?'+':'')}${(+v).toFixed(2)}%` : '—'; }
function fmtBNBSigned(v, n=5){ return Number.isFinite(+v) ? `${(+v>=0?'+':'')}${(+v).toFixed(n)} BNB` : '—'; }

function formatTimeHM(ts){
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}

function computePnlFields(ev){
  
  if (ev.type === 'Sell'){
    const pnl  = Number(ev.pnl_bnb);
    const roi  = Number(ev.pnl_pct);
    return {
      pnlBNB: Number.isFinite(pnl) ? pnl : null,
      pnlPct: Number.isFinite(roi) ? roi : null,
    };
  }
  
  return { pnlBNB: null, pnlPct: null };
}


function isHexAddr(v){
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

async function refreshTradeFeed(){
  if (!TRADE_FEED_EL) return;
  try{
    const data = await fetchJSON(API_ACTIONS);
    
    const arr = Array.isArray(data) ? data.slice().sort((a,b)=> new Date(b.ts)-new Date(a.ts)) : [];

    TRADE_FEED_EL.innerHTML = '';
for (const ev of arr){
  const model = ev.ai || WALLET_TO_MODEL.get(String(ev.wallet||'').toLowerCase()) || '';
  const modelNice = modelLabel(model);

  
  const rawToken = String(ev.token || '');
  const tokenAddrLC = rawToken.toLowerCase();
  const isAddr = /^0x[a-fA-F0-9]{40}$/.test(rawToken);
  const tokenSym  = '$' + (isAddr ? shortAddr(rawToken) : rawToken.replace(/^0x/i,''));
  const tokenHTML = isAddr
    ? `<a class="token" href="https://gmgn.ai/bsc/token/${tokenAddrLC}" target="_blank" rel="noopener">${escapeHTML(tokenSym)}</a>`
    : `<span class="token">${escapeHTML(tokenSym)}</span>`;

  const isBuy  = (String(ev.type).toLowerCase() === 'buy');
  const isSell = (String(ev.type).toLowerCase() === 'sell');

  
  const amountBNB  = Number(ev.amount_bnb);
  const { pnlBNB, pnlPct } = computePnlFields(ev);

  
  const card = document.createElement('div');
  card.className = `trade-item ${isBuy ? 'buy' : isSell ? 'sell' : ''}`;

  
  const head = document.createElement('div');
  head.className = 'trade-head';

  const title = document.createElement('div');
  title.className = 'trade-title';
  title.innerHTML = `
    <span class="model">${escapeHTML(modelNice)}</span>
    <span class="dash">—</span>
    <span class="action ${isBuy?'buy':'sell'}">${isBuy?'buy':'sell'}</span>
    ${tokenHTML}
  `;

  const time = document.createElement('div');
  time.className = 'trade-time';
  time.textContent = formatTimeHM(ev.ts);

  head.appendChild(title);
  head.appendChild(time);

  
  const body = document.createElement('div');
  body.className = 'trade-body';

  if (isBuy){
    const lblBuy = document.createElement('div'); lblBuy.className='trade-label'; lblBuy.textContent='BUY:';
    const valBuy = document.createElement('div'); valBuy.className='trade-val';
    valBuy.textContent = Number.isFinite(amountBNB) ? fmtBNB(amountBNB,5) : '—';
    body.append(lblBuy, valBuy);
  } else {
    const lblSell = document.createElement('div'); lblSell.className='trade-label'; lblSell.textContent='SELL:';
    const valSell = document.createElement('div'); valSell.className='trade-val';
    valSell.textContent = Number.isFinite(amountBNB) ? fmtBNB(amountBNB,5) : '—';

    const lblPnl = document.createElement('div'); lblPnl.className='trade-label'; lblPnl.textContent='PnL:';
    const valPnl = document.createElement('div'); valPnl.className='trade-val';
    if (Number.isFinite(pnlBNB) || Number.isFinite(pnlPct)){
      valPnl.classList.add(signClass(pnlBNB));
      const left  = Number.isFinite(pnlBNB) ? fmtBNBSigned(pnlBNB,5) : '—';
      const right = Number.isFinite(pnlPct) ? ` (${fmtPctSigned(pnlPct)})` : '';
      valPnl.textContent = left + right;
    } else {
      valPnl.textContent = '—';
    }
    body.append(lblSell, valSell, lblPnl, valPnl);
  }

  card.appendChild(head);
  card.appendChild(body);
  TRADE_FEED_EL.appendChild(card);
}

  } catch(e){
    console.error('refreshTradeFeed error:', e);
  }
}

function openModelModal(modelKey){
  const root = document.getElementById('model-modal-root');
  if (!root) return;

 
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const modal = document.createElement('div');
  modal.className = 'modal';

 
  const hdr = document.createElement('div'); hdr.className = 'modal-header';
  const title = document.createElement('div'); title.className = 'modal-title';
  const dot = document.createElement('span'); dot.className = 'dot';
  const color = modelColor(modelKey);
  dot.style.background = '#fff';
  dot.style.borderColor = color;

  title.append(dot, document.createTextNode(modelLabel(modelKey)));
  const btn = document.createElement('button'); btn.className='modal-close'; btn.textContent = '✕';
  btn.onclick = () => backdrop.remove();
  hdr.append(title, btn);

 
  const stats = document.createElement('div'); stats.className = 'modal-stats';

 
  const row = document.createElement('div'); row.className='modal-stats-row';

  const st1 = document.createElement('div'); st1.className='stat';
  st1.innerHTML = `<div class="label">PnL</div><div class="val">—</div>`;
  const st2 = document.createElement('div'); st2.className='stat';
  st2.innerHTML = `<div class="label">ROI</div><div class="val">—</div>`;
  const st3 = document.createElement('div'); st3.className='stat';
  st3.innerHTML = `<div class="label">Winrate</div><div class="val">—</div>`;

  row.append(st1, st2, st3);

 
  const chartWrap = document.createElement('div'); chartWrap.className='modal-chart';
 const chart = document.createElement('canvas');
 chartWrap.appendChild(chart);

  stats.append(row, chartWrap);

 
  const tblWrap = document.createElement('div'); tblWrap.className='modal-table-wrap';
  const ttl = document.createElement('div'); ttl.className='reasons-title';
  ttl.textContent = 'Reasons';
  const table = document.createElement('div'); table.className='reasons-table';
  const thead = document.createElement('div'); thead.className='reasons-head';
  thead.innerHTML = `<div>Time</div><div>Reason</div>`;
  const tbody = document.createElement('div'); tbody.className='reasons-body';

  table.append(thead, tbody);
  tblWrap.append(ttl, table);

 
  modal.append(hdr, stats, tblWrap);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);

 

 
  const rowWallet = getWalletRowForModel(modelKey);
  if (rowWallet){
    const pnl = Number(rowWallet.pnl_bnb) ?? null;
    const roi = Number.isFinite(+rowWallet.pnl_pct)
      ? +rowWallet.pnl_pct
      : (rowWallet.invested_bnb ? (+rowWallet.pnl_bnb / +rowWallet.invested_bnb) * 100 : null);

    const pnlEl = st1.querySelector('.val');
    const roiEl = st2.querySelector('.val');
    pnlEl.textContent = formatBNB(pnl);
    pnlEl.classList.add(signClassNum(pnl));
    roiEl.textContent = formatPct(roi);
    roiEl.classList.add(signClassNum(roi));
  }

 
  const addr = WALLETS[modelKey];
  if (addr){
    computeWalletWinrate(addr).then((wr) => {
      const el = st3.querySelector('.val');
      if (wr == null){ el.textContent = '—'; return; }
      el.textContent = formatPct(wr);
      el.classList.add(wr >= 50 ? 'positive':'negative');
    }).catch(()=>{  });
  }

 
let pts = getModelTimelinePoints(modelKey);
renderModalChart(chart, pts, color);

const ro = new ResizeObserver(() => {
  pts = getModelTimelinePoints(modelKey);
  renderModalChart(chart, pts, color);
});
ro.observe(chart.parentElement);

const stop = () => { try { ro.disconnect(); } catch{} backdrop.remove(); };
btn.onclick = stop;
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) stop(); });

 
  (async () => {
    const map = await fetchAllReasonsOnce();
    const list = (map && map[modelKey]) ? map[modelKey] : [];
    if (!Array.isArray(list) || list.length === 0){
      const empty = document.createElement('div');
      empty.className = 'reason-row';
      empty.innerHTML = `<div>—</div><div>No reasons yet</div>`;
      tbody.appendChild(empty);
      return;
    }
   
    const rows = list.slice().sort((a,b)=> new Date(b.time) - new Date(a.time));
    for (const r of rows){
      const rowEl = document.createElement('div');
      rowEl.className = 'reason-row';
      const t = document.createElement('div'); t.textContent = formatTimeFull(r.time);
      const txt = document.createElement('div'); txt.textContent = r.reason || '—';
      rowEl.append(t, txt);
      tbody.appendChild(rowEl);
    }
  })();
}

refreshWinrates();
setInterval(refreshWinrates, 10_000); 
  refreshCardsPnl();
  setInterval(refreshCardsPnl, 10_000);

  refreshTradeFeed();
  setInterval(refreshTradeFeed, 10_000);
})();
