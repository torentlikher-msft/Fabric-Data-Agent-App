# Fabric Data Agent Chat App

A React app for a "chat with your data" experience powered by your Fabric MCP data agent.  This is being provided for demo purposes only.

## What this app does

- Shows a single-screen chat UI where users ask data questions.
- Sends chat requests to a local Vite proxy route (`/api/chat`).
- The proxy calls your Fabric MCP server endpoint and returns the response to the UI.
- Automatically discovers MCP tools (`tools/list`) and calls the best matching one (`tools/call`).

## MCP endpoint used

You can specify the MCP server in the vite.config.js and app.jsx files.  Alternatively, you can specify the MCP in the app UI itself.

## Prerequisites

- Node.js 20+ (recommended for stable `fetch` + `crypto` support in tooling)
- Azure CLI installed locally
- Your Microsoft account signed in through Azure CLI

## Sign in with your Microsoft credentials

No client ID or tenant ID is required in this app.

1. Open a terminal.
2. Run:

```bash
az login
```

This uses your own Microsoft credentials locally.

The app acquires token scope:

`https://analysis.windows.net/powerbi/api/.default`

## Optional fallback token (local only)

You can still set a server-side fallback token in `.env`:

`FABRIC_BEARER_TOKEN=...`

This is not required when Azure CLI login is configured correctly.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Then click **Sign in with Microsoft credentials** in the app and start chatting.

## Build for production

```bash
npm run build
npm run preview
```

## Notes

- This project is optimized for local development.
- The chat route is implemented in Vite server middleware inside `vite.config.js`.
- If your data agent expects a specific tool argument name, the proxy attempts to infer it from the tool schema and falls back to `input`.
