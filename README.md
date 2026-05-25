# Threads Agent 🤖

> An autonomous AI agent that researches, generates, and publishes daily trading content on Threads — with a self-improving feedback loop that gets smarter every cycle.

---

## The Problem

Consistent content creation for trading niche accounts is time-consuming and mentally taxing. Traders who want to build an audience on Threads face three core challenges:

1. **Ideation fatigue** — Coming up with fresh, relevant content ideas every single day is exhausting, especially when market conditions change rapidly.
2. **Inconsistency** — Missing posting days breaks momentum and hurts algorithmic reach.
3. **No feedback loop** — Most creators post content without systematically analyzing what works and applying those learnings to future content.

Threads Agent solves all three.

---

## What It Does

Threads Agent is a Node.js-based autonomous agent that runs on a schedule and handles the entire content pipeline — from research to publishing — with minimal human intervention.

```
Every Monday
└── Researches trending angles in forex & crypto niche (via Tavily)
└── Generates 10 content ideas informed by past performance data
└── Evaluates last week's post metrics and updates its memory

Every Day at 6PM
└── Picks the next idea from the idea stock
└── Researches today's market context (news, sentiment, key events)
└── Generates 3 draft variations using Groq LLM
└── Sends drafts to your Telegram for review

You (via Telegram)
└── Reply "1", "2", or "3" to approve a draft
└── Reply "edit: [your text]" to use your own version
└── Reply "skip" to skip today

After Approval
└── Posts to Threads via Threads API
└── Tracks post ID for later analytics

Every Monday (alongside research)
└── Pulls performance metrics (views, likes, replies, reposts)
└── Analyzes patterns: what angles perform, what formats flop
└── Writes learnings to memory.json
└── Next cycle's research is informed by these learnings
```

---

## The Self-Improving Loop

This is what separates Threads Agent from a simple automation script.

Every cycle, the agent reads its own evaluation history before generating new content. Over time, `memory.json` accumulates insights like:

```json
{
  "learnings": [
    "Confessional angle gets 3x more replies than pure education",
    "Posts about BTC outperform forex content by 40% this month",
    "Hooks with specific numbers have higher stop-scroll rate"
  ],
  "avoid": [
    "Pure education without personal angle — low engagement",
    "Posts over 300 characters see higher drop-off"
  ],
  "best_performing": {
    "angles": ["confessional", "contrary opinion"],
    "formats": ["number hooks", "rhetorical questions"],
    "posting_time": "19:00"
  }
}
```

This memory is injected into every research and generation prompt — making the agent's output progressively more targeted and effective.

---

## Target Audience

- **Forex & crypto traders** who want to build a personal brand on Threads without spending hours on content creation
- **Solo content creators** in finance/trading niche who need a consistent posting system
- **Developers** looking for a real-world AI agent architecture with a feedback loop, tool orchestration, and LLM integration

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules) |
| LLM | Groq API (`llama-3.3-70b-versatile`) |
| Research | Tavily Search API |
| Publishing | Threads API (Meta) |
| Database | SQLite via `better-sqlite3` |
| Scheduler | `node-cron` |
| Notifications | Telegram Bot API |
| Memory | `memory.json` (flat file, human-readable) |

---

## Project Structure

```
threads-agent/
├── src/
│   ├── tools/
│   │   ├── research.js        # Tavily API — research ideas & market context
│   │   ├── generateContent.js # Groq API — generate draft posts
│   │   ├── publish.js         # Threads API — publish posts
│   │   ├── analytics.js       # Threads API — fetch post metrics
│   │   └── memory.js          # Read/write memory.json & SQLite logs
│   ├── agent.js               # Core orchestrator — decision making & evaluation
│   ├── scheduler.js           # Cron jobs — weekly & daily triggers
│   ├── db.js                  # SQLite setup & schema
│   └── index.js               # Entry point — CLI & Telegram listener
├── data/
│   ├── memory.json            # Agent's long-term learnings
│   └── threads.db             # Ideas, drafts, posts, metrics, logs
├── .env                       # API keys (never commit this)
├── .gitignore
└── package.json
```

**Architecture principle:** `agent.js` thinks, `tools/` executes. The agent is the brain; each tool is a capability it can call.

---

## Getting Started

### Prerequisites

- Node.js v18+
- A [Groq API key](https://console.groq.com) (free tier available)
- A [Tavily API key](https://tavily.com) (free tier available)
- A Telegram bot token (via [@BotFather](https://t.me/botfather))
- Threads API access (via [Meta Developer Portal](https://developers.facebook.com))

### Installation

```bash
git clone https://github.com/your-username/threads-agent.git
cd threads-agent
npm install
```

### Configuration

Create a `.env` file in the root directory:

```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=your_tavily_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
THREADS_APP_ID=your_threads_app_id
THREADS_APP_SECRET=your_threads_app_secret
THREADS_ACCESS_TOKEN=your_threads_access_token
```

### Running the Agent

```bash
# Run the scheduler (production mode — keeps running)
node src/index.js

# Manually trigger weekly research & idea generation
node src/index.js --weekly

# Manually trigger daily draft generation
node src/index.js --daily
```

### First Run

Always run `--weekly` first to populate the idea stock before running `--daily`:

```bash
node src/index.js --weekly
node src/index.js --daily
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `ideas` | Weekly idea stock with angle, topic, context, and status |
| `drafts` | Generated draft variations per idea |
| `posts` | Published posts with Threads post ID |
| `metrics` | Performance data per post (views, likes, replies, reposts) |
| `logs` | Agent activity log for debugging and auditing |

---

## Telegram Commands

Once a draft is sent to your Telegram:

| Command | Action |
|---|---|
| `1` / `2` / `3` | Approve the selected draft variant |
| `edit: [your text]` | Override with your own version |
| `skip` | Skip today's post |

---

## Roadmap

- [x] Weekly research & idea generation
- [x] Daily draft generation with market context
- [x] Telegram approval workflow
- [x] Self-improving memory loop
- [ ] Threads API publishing (`publish.js`)
- [ ] Post analytics fetching (`analytics.js`)
- [ ] Railway deployment guide

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## License

MIT