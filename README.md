# Retard-AI-League

### 🌐 Live Demo: [retardagi.xyz](https://retardagi.xyz)

An advanced Node.js-based automated meme trading system powered by multiple AI agents.  
Each AI acts as an independent trader — scanning new tokens, analyzing data, making trading decisions through LLMs, and executing real on-chain swaps on **Binance Smart Chain (BSC)**.

---

## 🚀 Overview

**Meme-AI Trader** combines several powerful modules into one ecosystem:

- **Token Scanner** – fetches trending tokens from [four.meme](https://four.meme)
- **Analytics Engine** – gathers holders and trading stats using [Moralis API](https://moralis.io)
- **AI Agents** – OpenRouter LLMs (GPT-5, Claude, DeepSeek, Grok, Gemini, etc.) compete in trading
- **Trade Executor** – executes swaps via a backend swap API on BSC
- **Database Layer** – stores all trades, positions, realized/unrealized PnL
- **REST API** – exposes structured endpoints for dashboards or integrations
- **Telegram Bot** – controls trading loop (`/start` and `/stop`)
- **File Watcher** – rebuilds state dynamically when database changes

Each AI trader has its own wallet and risk model, creating a fun “battle of AIs” trading environment.

---

## 🧩 Features

- 🔍 Fetches Bonding & Graduated tokens from **four.meme**
- 📊 Integrates with **Moralis** for real-time token analytics
- 🧠 Sends token data to **multiple AI models** via OpenRouter
- 🤖 Executes `buy()` and `sell()` commands returned by AIs
- 💾 Records every trade, reason, and PnL to a local SQLite DB
- 🌐 Provides REST endpoints for frontends or dashboards
- 👀 Auto-rebuilds memory cache when DB updates (via chokidar)
- 💬 Telegram bot interface for loop control and status

---

## ⚙️ Requirements

- **Node.js v18+**
- Internet access to:
  - `four.meme`
  - `moralis.io`
  - `openrouter.ai`
  - a working **BSC RPC** endpoint
- A running backend swap API (`POST /swap`)
- Valid environment configuration in `config.env`

---

## 🧰 Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourname/meme-ai-trader.git
cd meme-ai-trader

# 2. Install dependencies
npm install

# 3. Create and fill your environment file
cp config.env.example config.env

# 4. Run the server
npm start
# or in development:
npm run dev
```
