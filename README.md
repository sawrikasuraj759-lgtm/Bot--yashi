# ⚡ YASHI HALLS — 24/7 WhatsApp Bot Management Platform & Engine

Official production-grade full-stack WhatsApp Bot Management Platform and 24/7 Bot Engine for **YASHI HALLS PRO**, powered by **Node.js**, **Express**, **Baileys Multi-Device**, and **Google Gemini 3.8 Flash**.

---

## 🌟 Key Architecture & Capabilities

1. **Real Baileys Multi-Device WhatsApp Worker**:
   - Built on `@whiskeysockets/baileys` with session persistence in `./data/whatsapp_session`.
   - Automatic reconnection on network interruption with reconnection backoff.
   - Dual-mode device pairing:
     - **8-Digit Pairing Code**: Enter your phone number with country code (e.g. `94712345678`) to receive an instant pairing code for WhatsApp Linked Devices.
     - **Dynamic QR Code**: Real QR Code streaming from the Baileys socket directly to the web dashboard.
2. **Server-Side AI Assistant (Google Gemini 3.8 Flash)**:
   - Full integration with `@google/genai` TypeScript SDK.
   - Handles the `.ai <prompt>` WhatsApp command and provides live responses.
   - Protected API keys: `GEMINI_API_KEY` is securely held in server environment variables and never exposed to client browsers.
3. **Live Web Management Dashboard**:
   - Full real-time metrics: true socket latency, process uptime, total messages processed, commands executed, and AI queries.
   - Real container controls: Start, Stop, and Restart Baileys socket on demand.
   - Live Terminal Console: Streams real timestamped server logs from the background worker.
   - Safe Session Management: Cleanly wipe session credentials to re-pair any WhatsApp number.
4. **Firebase Authentication & Firestore Database**:
   - Google Sign-In and Email/Password signup & login.
   - User document persistence for wallet balance, slot allocation, and credentials.

---

## 🤖 Built-In Bot Commands

All commands use the configurable trigger prefix (default: `.`):

| Command | Usage | Description |
| :--- | :--- | :--- |
| **`.menu`** | `.menu` | Renders the complete formatted YASHI HALLS PRO interactive menu |
| **`.help`** | `.help` | Displays command usage documentation |
| **`.ping`** | `.ping` | Measures round-trip latency and server uptime |
| **`.ai`** | `.ai <prompt>` | Asks Gemini 3.8 Flash a question and returns formatted response |
| **`.owner`** | `.owner` | Shows verified bot owner contact credentials |
| **`.groupinfo`**| `.groupinfo` | Displays group name, participant count, and admin information |
| **`.tagall`** | `.tagall [msg]`| Broadcast mentions all members in a group |
| **`.games`** | `.games` | Opens fun interactive games menu |
| **`.roll`** | `.roll` | Rolls a 6-sided dice (1-6) |
| **`.flip`** | `.flip` | Flips a coin (Heads / Tails) |
| **`.public`** | `.public` | *(Owner only)* Allows all group members and contacts to use commands |
| **`.private`**| `.private` | *(Owner only)* Restricts bot commands strictly to the bot owner |

---

## ⚙️ Environment Variables (`.env`)

Configure your environment variables in `.env` (or via the AI Studio Secrets panel):

```env
# Port for the Node.js Express server
PORT=3000

# Required for Gemini 3.8 Flash AI Chat (.ai command and dashboard AI)
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# Base Application URL
APP_URL="http://localhost:3000"
```

---

## 🚀 Installation & Running

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Full-Stack Development Server (Express + Vite)
```bash
npm run dev
```
The server will start on port `3000` with the Baileys engine ready to pair.

### 3. Production Build & Start
```bash
npm run build
npm start
```

---

## 📲 How to Connect Your WhatsApp Account

1. Open the **YASHI HALLS** web dashboard.
2. Sign in with your Google Account or Email.
3. Click on **Pair Device** (or navigate to **Deployments > WhatsApp Pairing**).
4. Choose **Pair Code**:
   - Select country code (e.g., `+94` for Sri Lanka) and enter your WhatsApp phone number.
   - Click **Generate Pairing Code**.
   - Copy the 8-digit code (e.g., `ABCD-EFGH`).
5. On your phone:
   - Open WhatsApp > **Settings > Linked Devices > Link a Device**.
   - Tap **"Link with phone number instead"** at the bottom.
   - Enter the 8-digit code.
6. Once connected, your bot status will switch to **ONLINE** and it will respond to commands 24/7!

---

## 🛡️ 24/7 Cloud Hosting Recommendations

To run YASHI HALLS PRO 24/7 continuously:
1. **Persistent Worker**:
   - For cloud environments (such as Cloud Run, Render, VPS, Railway), ensure persistent volume storage is mapped to `./data/whatsapp_session` so session credentials survive container redeployments.
2. **Memory Requirements**:
   - Minimum: 512 MB RAM.
   - Recommended: 1 GB RAM for handling high-volume WhatsApp groups.
3. **Health Check Endpoint**:
   - Ping `/api/health` to monitor service uptime and socket status.

---

## 🔧 Troubleshooting

- **Pairing Code expired or rejected**:
  - Click **Disconnect / Clear Session** on the dashboard to wipe stale credentials, then request a fresh 8-digit code.
- **Bot does not respond to group members**:
  - The bot might be in `private` mode. Send `.public` from the owner's WhatsApp number to open access.
- **Gemini AI not responding**:
  - Verify that `GEMINI_API_KEY` is set in your environment / Secrets panel.
