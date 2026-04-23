# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SAGE3 (Smart Amplified Group Environment) is a collaborative platform for data-rich work on high-resolution display walls with AI integration. It consists of:

- **`webstack/`** — Nx monorepo with a Node.js/Express backend (`homebase`) and React SPA (`webapp`)
- **`deployment/`** — Docker Compose configurations for all backend services
- **`foresight/`** — Python backend for AI/ML kernels and Jupyter integration
- **`seer/`** — FastAPI server for AI agents (chat, code, web, image, PDF)
- **`clients/`** — Native clients (Electron, C#, Swift, CLI)

## Development Commands

All commands run from `webstack/` unless noted.

```bash
# Install dependencies (first time)
cd webstack && yarn

# Start backend services (Terminal 1)
cd deployment && docker-compose -f docker-compose-backend.yml up --remove-orphans

# Start Node.js backend server (Terminal 2)
cd webstack && yarn start

# Start React frontend with hot reload (Terminal 3)
cd webstack && yarn start webapp

# Production build
yarn buildallprod   # build all projects
yarn prod           # stage and prepare for production

# Seer (Python AI agents)
cd seer && ./dev.sh
```

## Monorepo Structure

The Nx monorepo uses `@sage3/*` path aliases throughout:

```
webstack/
├── apps/
│   ├── homebase/     — Express server entry point (src/main.ts)
│   └── webapp/       — React SPA entry point (src/main.tsx)
└── libs/
    ├── sagebase/     — Core auth/DB/pubsub framework (published to npm)
    ├── sageplugin/   — Plugin API for app developers (published to npm)
    ├── shared/       — Shared types, permissions, utilities
    ├── backend/      — Backend-only utilities (AI, generics)
    ├── frontend/     — Frontend utilities (hooks, stores, providers, UI)
    ├── applications/ — 42 SAGE3 apps (AIPane, CodeEditor, PDFViewer, etc.)
    └── workers/      — Background job workers
```

Key aliases: `@sage3/sagebase`, `@sage3/sageplugin`, `@sage3/shared/*`, `@sage3/frontend`, `@sage3/backend`, `@sage3/applications/*`.

## Architecture

### Communication Model
- **WebSocket `/api`** — Main authenticated SAGE3 API (state sync)
- **WebSocket `/yjs`** — Collaborative editing via Yjs CRDT
- **WebSocket `/rtc`** — WebRTC signaling (unauthenticated)
- **HTTP REST `/api/*`** — Data management endpoints
- **HTTP `/auth/*`** — Authentication (guest, local, JWT, Google OAuth, CILogon)

### Service Dependencies
The Node.js server proxies to external services configured in `sage3-dev.hjson` / `sage3-prod.hjson`:
- **Redis** (6379) — Primary database and pubsub
- **Chroma DB** (8100) — Vector embeddings
- **Kernel Server** (8000) — Python/Jupyter execution (`foresight`)
- **Agents Server** (9999) — AI agents (`seer`)
- **Fluentd** (24224) — Log aggregation

### State Management Pattern
The frontend uses Zustand stores (in `libs/frontend/src/lib/stores/`) that subscribe to WebSocket events. State changes flow: User action → REST/WS call → Redis pubsub → WebSocket broadcast → Zustand store update → React re-render.

### Authentication
Passport.js with 5 strategies: guest, local, JWT (RS256), Google OAuth, CILogon. Sessions stored in Redis. Admin users defined in server config.

## Key Configuration

- **`webstack/sage3-dev.hjson`** — Dev server config (port 3333, Redis address, proxy targets, enabled apps)
- **`webstack/sage3-prod.hjson`** — Production server config
- **`webstack/nx.json`** — Nx build configuration (npm scope: `@sage3`)
- **`webstack/tsconfig.base.json`** — TypeScript path aliases

## Tech Stack

**Frontend:** React 18, TypeScript, Chakra UI, Zustand, Yjs, Monaco Editor, Vega/Plotly/D3/ECharts, Leaflet/MapLibre, Three.js, Tldraw

**Backend:** Node.js (18–20), Express, Redis 4, SAGEBase, Passport.js, BullMQ, Twilio

**Python:** FastAPI, LangChain, Celery, Jupyter, ChromaDB

**Build:** Nx 14, Webpack, Jest, ESLint/Prettier
