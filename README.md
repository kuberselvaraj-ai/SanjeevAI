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
