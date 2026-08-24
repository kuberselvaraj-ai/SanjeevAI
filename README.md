# Sanjeev AI

A standalone, Claude-style desktop client for the Kimi (Moonshot AI) API — chat with
**Kimi K3**, **Kimi Code (K2.7)**, **Kimi Code Highspeed**, and **Kimi K2.6**, plus a
built-in **video generation** panel (MiniMax Hailuo, since the Kimi API does not expose
video generation).

## Features

- Streaming chat with Markdown rendering, syntax-highlighted code blocks, and copy buttons
- **File uploads** — attach PDF, Word, Excel, PowerPoint, text/code files (extracted by
  the Kimi Files API, OCR included) or images (understood natively by Kimi K3 vision),
  then ask questions about them. Multiple files per message, kept as conversation context
- Model switcher in the composer — switch models mid-conversation
- Multiple conversations with local history, rename-free auto titles, delete
- Video generation: text-to-video and image-to-video (first frame), with status
  polling, in-app playback and MP4 download
- **Web search toggle** (globe icon) — lets Kimi search the internet for current
  facts; the app also injects the current date/time into every conversation
- Light (warm paper) and dark themes
- API keys stored only in the app's local storage on your machine

## Requirements

- macOS with [Node.js](https://nodejs.org) 18 or newer (`node -v` to check)
- A Kimi API key from [platform.moonshot.ai](https://platform.moonshot.ai/console/api-keys)
- (Optional, for video) A MiniMax API key from [platform.minimax.io](https://platform.minimax.io/)

## Quick start — run as a Mac desktop app (Electron)

```bash
cd app
npm install
npm run electron:dev
```

A desktop window opens. Click **Settings** (bottom-left) and paste your Kimi API key —
that's it.

## Build a double-clickable `.app` / `.dmg`

```bash
npm run electron:dist:mac
```

The installer lands in `release/` (e.g. `release/Sanjeev AI-1.0.0.dmg`). The app is
unsigned, so on first launch: right-click the app → **Open** → **Open** (Gatekeeper).

## Alternative: run in a browser

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Windows build

```bash
npm run electron:dist:win   # produces release/Sanjeev AI Setup 1.0.0.exe
```

Works when built from a Mac. The installer is unsigned — Windows SmartScreen will
warn once ("More info → Run anyway").

## iPhone / iPad

Electron can't build iOS apps. Instead use the hosted web version: publish the site
(the Publish button on the Kimi version card), open the URL in Safari on the iPhone,
then Share → **Add to Home Screen**. It installs as a full-screen app icon.
(A true App Store build would require a Capacitor wrapper, Xcode, and an Apple
Developer account.)

## Using the app

| Task | Where |
|---|---|
| Add / change API keys | Sidebar → **Settings** |
| Switch model | Model button in the message composer |
| Generate video | Sidebar → **Video** tab |
| Dark mode | Moon icon, bottom-left |

**China-platform keys:** if your key is from `platform.moonshot.cn`, open
Settings → Advanced and change the Kimi base URL to `https://api.moonshot.cn/v1`.

## Troubleshooting

**`npm install` fails with `ENOTFOUND npm.mirrors.msh.team`** — your npm is pointed at a
stale mirror. Fix:

```bash
npm config set registry https://registry.npmjs.org
rm -rf node_modules package-lock.json
npm install
```

## Notes & limits

- Conversations and settings are stored in the app's local storage on this Mac only.
  Clearing app data removes them; they do not sync between devices.
- Video generation uses your own MiniMax account and incurs per-video costs on that
  account (e.g. Hailuo 2.3, 6–10 s, 768P/1080P).
- Video download URLs from MiniMax expire after ~24 hours — download clips you want to
  keep.

## Tech

React + TypeScript + Vite + Tailwind (renderer), Electron (shell). The Kimi API is
OpenAI-compatible and called directly from the app; no server is involved.

## Hosted mode (multi-user web app)

The same codebase now runs as a hosted, multi-user web app (tRPC + Hono + MySQL via
Drizzle). In the browser it requires login; the Electron desktop app is unaffected and
still uses each user's own API keys.

- **Accounts**: email/password signup + "Sign in with Kimi" (OAuth). Session = httpOnly
  JWT cookie (1 year).
- **Server-side keys**: `MOONSHOT_API_KEY` and `MINIMAX_API_KEY` are read from server
  env (`.env`, gitignored) — they never reach the browser. The browser calls
  `/api/hosted/chat` (SSE relay) and `/api/hosted/extract`; video generation goes
  through the `video` tRPC router.
- **Plans & metering**: every chat records token usage and every video records one
  credit in `usage_events`. Monthly limits live in `contracts/constants.ts` (`PLANS`):
  Free = 500K tokens + 3 videos, Pro = 8M tokens + 30 videos. Admin role = unlimited.
- **Admin**: the app owner (portal creator) becomes admin automatically when signing
  in with Kimi. Alternatively set `ADMIN_EMAILS=you@example.com` in `.env` and sign up
  with that email. Admin UI at `/#/admin` — user list, monthly usage, plan and role
  management.

### Run the hosted app locally

```bash
npm run db:push   # sync schema to the database (first time)
npm run dev       # http://localhost:3000 — API + frontend
```

### Production

`npm run build` outputs the frontend to `dist/public` and the server bundle to
`dist/boot.js`; `npm start` serves both on port 3000. A `Dockerfile` is included.
