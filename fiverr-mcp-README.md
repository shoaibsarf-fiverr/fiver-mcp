# 🟢 Fiverr MCP Server — shoaibshoai

A custom **Model Context Protocol (MCP) server** that lets Claude read and analyze your Fiverr seller profile in real-time.

---

## 📦 What's Included

| Tool | Description |
|------|-------------|
| `get_fiverr_profile` | Full seller profile: level, rating, bio, skills, languages |
| `get_fiverr_gigs` | All active gigs with prices, ratings, delivery times |
| `get_fiverr_reviews` | Recent buyer reviews (adjustable limit) |
| `get_fiverr_stats` | Quick stats summary: rating, level, response time |
| `analyze_fiverr_profile` | Full analysis + improvement suggestions from Claude |

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
```

You'll see:
```
🚀 Fiverr MCP Server running on port 3000
   SSE URL: http://localhost:3000/sse
```

### 3. Connect to Claude

1. Open **claude.ai** → click your profile icon → **Settings**
2. Go to **Connectors** (or **Integrations**)
3. Click **"Add custom connector"**
4. Enter URL: `http://localhost:3000/sse`
5. Click **Add**

That's it! Claude can now access your Fiverr profile.

---

## 💬 Example Claude Prompts

Once connected, ask Claude:

- *"Show me my Fiverr profile stats"*
- *"What gigs do I have listed on Fiverr?"*
- *"Analyze my Fiverr profile and suggest improvements"*
- *"What are my recent Fiverr reviews?"*
- *"Help me write a better gig description based on my current ones"*

---

## 🌐 Deploy to the Internet (Optional)

To use this from claude.ai on any device (not just your laptop), deploy to a free cloud service:

### Option A: Railway (Free)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Your URL will be: `https://your-app.railway.app/sse`

### Option B: Render (Free)
1. Push this folder to GitHub
2. Go to render.com → New Web Service
3. Connect your repo, set start command: `npm start`
4. Use the Render URL in Claude: `https://your-app.onrender.com/sse`

### Option C: ngrok (Instant tunnel for testing)
```bash
# Install ngrok, then:
ngrok http 3000
# Use the https URL it gives you + /sse
```

---

## 🔧 Configuration

Edit `server.js` line 14 to change the seller username:
```js
const SELLER_USERNAME = "shoaibshoai"; // ← change this
```

Change the port via environment variable:
```bash
PORT=8080 npm start
```

---

## ⚠️ Important Notes

- **Fiverr has no official public API.** This server uses web scraping of your public profile page.
- Data availability depends on Fiverr's Cloudflare protection. Some fields may be limited.
- For richer data (orders, messages, earnings), Fiverr would need to provide OAuth API access — which they currently don't offer publicly.
- For best results with reviews, consider upgrading to a headless browser approach (Playwright).

---

## 📁 Files

```
fiverr-mcp/
├── server.js       ← Main MCP server
├── package.json    ← Dependencies
└── README.md       ← This file
```
