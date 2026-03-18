# SAGE3 Architecture Overview

> Written by analyzing the actual codebase (March 2026).
> Intended as a reference for developers and AI assistants — read this before
> touching the codebase rather than re-reading the source files.

---

## What is SAGE3?

SAGE3 is a web-based collaborative workspace. Users join **Rooms**, open **Boards** inside those rooms, and place **Apps** on those boards in real time. Apps range from sticky notes and PDF viewers to Jupyter notebooks, maps, and AI chat. Multiple users share the same board simultaneously with live cursor tracking and fully synchronized state.

---

## Repository Layout

```
next/
├── webstack/               # All TypeScript/Node/React code
│   ├── apps/
│   │   ├── homebase        # Main server (state, auth, WS) — port 3000
│   │   ├── homebase-files  # File server (upload/download) — port 3002
│   │   ├── homebase-yjs    # Yjs sync server — port 3001
│   │   └── webapp          # React frontend (served by homebase)
│   ├── libs/
│   │   ├── sagebase        # Redis abstraction + auth (SAGEBase)
│   │   ├── shared          # Shared types, schemas, constants
│   │   ├── applications    # All built-in app implementations
│   │   ├── frontend        # React hooks, Zustand stores, WS client
│   │   ├── backend         # Shared server utilities (collection base, permissions)
│   │   ├── sageplugin      # Plugin iframe messaging lib (npm-published)
│   │   └── workers         # BullMQ background job processors
│   └── clients/
│       ├── electron        # Electron desktop wrapper (Mac/Win/Linux)
│       ├── pycli           # Python CLI client
│       ├── cli             # Node CLI client
│       ├── csharp          # C# client (maintenance status unknown)
│       └── swift           # Swift client (maintenance status unknown)
├── seer/                   # Python AI service (FastAPI) — port 9999
├── foresight/              # Jupyter kernel proxy (Python)
├── sage_seer/              # LangGraph agent framework (Python, newer)
└── deployment/             # Docker/Kubernetes deployment configs
```

**Monorepo tooling**: NX 14 + Yarn. The team considers NX overhead but it is deeply embedded in the build pipeline and hard to remove.

---

## The Three Server Processes

### 1. homebase — Main Server (port 3000)

**Entry**: `apps/homebase/src/main.ts`

#### Startup sequence (exact order)

1. DNS order forced to IPv4-first; config loaded from hjson
2. Express app created with: trust proxy, cookie parser, JSON body (5 MB limit), Helmet, CORS, compression
3. HTTP server created; listens on `config.port`
4. **SAGEBase initialized** — Redis client created, all four modules started (see SAGEBase section)
5. NLP model loaded (`SAGEnlp`)
6. **Collections loaded** (`loadCollections()`) — all 13 collections created in Redis; default "Main Room" and "Main Board" created if none exist; orphaned link cleanup set up (throttled 5 s)
7. Twilio configured (video tokens, 6-hour TTL)
8. HTTP router registered (authenticated endpoints for all collections)
9. **Two WebSocket servers created**:
   - `apiWebSocketServer` at `/api` — main API, authenticated
   - `logsServer` at `/logs` — log broadcast, no auth
10. **HTTP upgrade handler** intercepts WebSocket handshakes:
    - `/logs` — passed through directly
    - `/api` — if JWT enabled: extracts bearer token, verifies RS256, calls `SBAuthDB.findOrAddAuth()`; otherwise: checks `session.passport.user`; connection destroyed if auth fails

**Horizontal scaling**: Yes — all state is in Redis; multiple homebase instances share the same Redis cluster.

Key routes:
| Route | Purpose |
|-------|---------|
| `WS /api` | Main WebSocket (authenticated) — all CRUD + subscriptions |
| `WS /logs` | Log stream (no auth) |
| `GET /info` | Server metadata (no auth) |
| `GET /time` | Server time (no auth) |
| `/api/agents/*` | Proxy to Python seer service |
| `/api/kernels/*` | Proxy to foresight (Jupyter), supports SSE streaming |
| `/api/nlp` | NLP intent endpoint |

#### How collection HTTP routes work

`sageRouter<T>(collection)` auto-generates an Express router for every collection with standard REST endpoints (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`). Each route runs `checkPermissionsREST(collection)` middleware before executing. Collections can add custom routes on top (e.g. `POST /apps/preview`).

#### How WebSocket routing works

`wsAPIRouter()` parses the route string from the incoming message, matches it to a collection's `wsRouter()`, and calls `sageWSRouter<T>()` which dispatches based on `method` (POST / GET / PUT / DELETE / SUB / UNSUB).

---

### 2. homebase-files — File Server (port 3002)

**Entry**: `apps/homebase-files/src/main.ts`

Express server. SAGEBase initialized identically to homebase (same Redis, same auth). No WebSocket.

#### Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/files/:id/:token` | UUID v5 token | Download file by ID with signed token |
| `GET /api/files/download/:url` | None | Proxy-fetch remote URL |
| `POST /api/assets/upload` | Session/JWT | Multipart file upload |
| `GET /api/assets/*` | Session/JWT | Asset queries |

**UUID v5 tokens**: generated from `(fileId + config.namespace)` — stateless, verifiable without a database lookup.

#### Upload pipeline

```
POST /api/assets/upload (multipart/form-data)
  → multer stores files to local filesystem
  → for each file:
      1. MetadataProcessor (BullMQ) — exiftool extracts EXIF, detects creation date
      2. ProcessFile (BullMQ):
           images → ImageProcessor — generates multiple thumbnail sizes (sharp)
           PDFs   → PDFProcessor  — converts pages to images (pdfjs)
           others → skipped
      3. MessageCollection.add() — progress notifications pushed to clients via WS
  → AssetsCollection.addBatch() — stores asset metadata to Redis
  → returns array of asset IDs
```

**File storage**: Local filesystem under `config.public`. No S3 or object storage — scaling homebase-files requires a shared filesystem mount.

**Communication back to homebase**: homebase-files writes directly to the shared Redis (same SAGEBase instance). No HTTP calls between the two servers. Clients subscribed to the ASSETS collection via homebase automatically receive the new asset documents.

**Horizontal scaling**: Yes in theory, but requires a shared filesystem for the uploaded files (e.g. NFS or S3 swap-in).

#### BullMQ Workers (libs/workers)

Three sandboxed workers run in homebase-files, each as a `SandboxedJob` (isolated Node.js process):

**MetadataProcessor** (`workers/src/lib/metadata.ts`)
- Runs `exiftool-vendored` (max 2 processes) on every uploaded file
- Cleans up result: strips `ProfileDescription` keys, converts `ExifDateTime/ExifTime/ExifDate` to strings, removes `Cells` (notebooks) and `Features` (GeoJSON) to avoid huge payloads
- Writes a `<filename>.json` sidecar file alongside the upload
- Returns: `{ file, id, data (exif tags), result (json filename) }`

**ImageProcessor** (`workers/src/lib/image.ts`)
- SVG files are passed through unchanged (no rasterisation)
- All other images: uses `sharp` to generate **4 WebP versions** at fractional widths (1/8, 1/4, 1/2, full) capped at the 16383px WebP limit, plus one **full-size JPEG** at 95% quality
- Respects EXIF orientation via `.rotate()` before processing
- Returns: `{ filename, url (smallest WebP), fullSize (JPEG), width, height, aspectRatio, sizes[] }`
- The `url` field points to the smallest WebP — this is the default display resolution; `fullSize` is used when the user requests full quality

**PDFProcessor** (`workers/src/lib/pdf.ts`)
- Uses `pdfjs-dist` (legacy build) + `node-canvas` as the render backend
- For each page: renders at ~2500px on the long axis (scale clamped 1–8), then generates **multiple WebP resolutions** halving down to 500px minimum using lanczos2 resampling
- Also extracts all page text content and saves as `<filename>-text.json` — this is what the AI PDF analysis endpoint reads
- Returns: array of per-page size arrays with URLs and dimensions

---

### 3. homebase-yjs — Yjs Sync Server (port 3001)

**Entry**: `apps/homebase-yjs/src/main.ts`

Express server with SAGEBase initialized for auth only (no collection usage).

#### Why it cannot scale horizontally

Yjs documents live **in-memory** inside the `y-websocket` library. There is no shared persistence backend (no Redis Yjs provider, no LevelDB). Two instances would maintain independent document states and diverge immediately. To make this scalable, a shared Yjs persistence adapter (e.g. `y-redis`) would need to be added.

#### WebSocket endpoints

**`WS /yjs`** (authenticated):
- HTTP upgrade checks `session.passport.user`; rejects if no session
- `YUtils.setupWSConnection()` from y-websocket handles the Yjs sync protocol
- Document state is in-memory only — **not persisted across server restarts**

**`WS /rtc`** (⚠️ no authentication):
- Public endpoint — anyone who knows a room ID can connect
- In-memory `Map<roomId, WebSocket[]>` tracks connected sockets per room
- Message types: `join` (add to room), `pixels` (broadcast cursor/data to room), `leave` (remove from room)
- Cleanup on socket close removes from all rooms
- Used for WebRTC peer-to-peer signaling and cursor pixel sharing

---

## SAGEBase (libs/sagebase)

The team's own framework wrapping Redis. Initialized as a singleton on server startup.

```
SAGEBase.init(config)
  ├── SBDatabase  — document storage
  ├── SBPubSub    — event broadcasting
  ├── SBAuth      — authentication + sessions
  └── SBLogger    — Fluentd integration
```

### SBDatabase — Redis document store

Redis key structure:
```
SAGE3:DB:APPS:<docId>    → JSON string (full document)
SAGE3:DB:BOARDS:<docId>  → JSON string
...
index:APPS               → RediSearch index on {roomId, boardId, type}
```

Each collection is a `SBCollectionRef` that:
- Generates UUIDs for new documents
- Merges `_id`, `_createdAt`, `_updatedAt`, `_createdBy`, `_updatedBy` into every document
- Supports field-based queries via RediSearch index
- Supports optional TTL (used by MESSAGE collection: 60-second auto-expiry)
- On every write, publishes a `{type, col, doc}` message to PubSub

### SBPubSub — broadcast layer

Channel naming: `SAGE3:PUBSUB:APPS`, `SAGE3:PUBSUB:BOARDS`, etc.

Each subscriber gets a **dedicated Redis connection** (`client.duplicate()`) with a pattern subscription to `SAGE3:DB:<COLLECTION>:*`. This is what enables cross-instance broadcasts — Instance 1 writes to Redis, Instance 2's PubSub subscriber fires and pushes to its connected WebSocket clients.

### SBAuth — authentication

**Session config**:
```
Store:      RedisStore at SAGE3:AUTH:SESS:<sessionId>
httpOnly:   true
secure:     true (production only)
sameSite:   'lax'
maxAge:     691200000 ms (8 days default)
```

**Passport strategies** (each configured independently in hjson):

| Strategy | Library | ID field | Notes |
|----------|---------|----------|-------|
| `guest` / `spectator` | custom | generated | Anonymous; spectator = read-only |
| `jwt` | passport-jwt (RS256) | `payload.sub` | Name from `payload.name`; external API use |
| `google` | passport-google-oauth20 | `profile.id` | Name, email, photo from profile |
| `apple` | passport-apple | `profile.id` | — |
| `cilogon` | passport-oauth2 | `profile.id` | Academic federation SSO |

All strategies call `SBAuthDB.findOrAddAuth(provider, id, extras)` which finds or creates the user document in Redis.

**OAuth callback flow**: provider redirects with `code` + `state` → Passport verifies → `req.logIn(user)` creates session → redirect to `/` (or `/login?error=...` on failure).

**⚠️ Auth fragility points** (noted from code + author):
1. Session and JWT both work, but concurrent use of both in the same request can cause conflicts
2. Role is determined by **provider name only** (hardcoded in `permissions.ts`) — there is no per-user role stored in the database
3. The WebRTC endpoint (`/rtc`) has **zero authentication**
4. Changing a user's role requires changing their auth provider, not a role field

### SBLogger — Fluentd

Wraps Fluentd client. Log level controlled by `config.fluentd.databaseLevel`:
- `all` — logs every read, write, subscribe
- `partial` — logs writes only
- `none` — disabled

---

## Backend Library (libs/backend)

Shared utilities used by all three servers.

### SAGE3Collection\<T\> — base class for all 13 collections

**File**: `libs/backend/src/lib/generics/SAGECollection.ts`

Every collection (Apps, Boards, Rooms, etc.) extends this. It wires together:
- A `SBCollectionRef` (Redis operations)
- An auto-generated **Express router** via `sageRouter<T>()`
- A **WebSocket handler** via `sageWSRouter<T>()`
- Cascaded deletes (e.g. deleting a Room cascades to its Boards, then Apps)

CRUD methods: `add`, `addBatch`, `get`, `getBatch`, `getAll`, `query`, `update`, `updateBatch`, `delete`, `deleteBatch`, `deleteAll`

Subscription methods: `subscribe(id)`, `subscribeAll()`, `subscribeByQuery(field, value)`

### sageWSRouter\<T\> — WebSocket dispatcher

**File**: `libs/backend/src/lib/generics/SAGEWSRouter.ts`

Handles all six WS methods:
- `POST` → `collection.add()`
- `GET` → `collection.get()` or `collection.getAll()`
- `PUT` → `collection.update()`
- `DELETE` → `collection.delete()`
- `SUB` → parses query params, calls `collection.subscribeByQuery()`, stores unsub fn in SubscriptionCache
- `UNSUB` → retrieves unsub fn from SubscriptionCache, calls it (closes Redis subscriber connection)

### SubscriptionCache — per-connection subscription tracking

**File**: `libs/backend/src/lib/utils/subscription-cache.ts`

Created fresh for each WebSocket connection. Maps `messageId → [unsubscribeFn]`. On `UNSUB` or socket close, all stored functions are called, closing their dedicated Redis connections. This is how the system avoids Redis connection leaks.

### Permissions (RBAC)

**File**: `libs/backend/src/lib/generics/permissions.ts`

Role derived from auth provider:

| Provider | Role |
|----------|------|
| `admin` (config list) | `admin` |
| `google`, `apple`, `jwt`, `cilogon` | `user` |
| `guest` | `guest` |
| `spectator` | `spectator` |

Roles are checked via `SAGE3Ability.can(role, action, resource)` (CASL rules engine from `@sage3/shared`) **on every HTTP and WS request**.

### SocketPresence — online/offline tracking

**File**: `libs/backend/src/lib/utils/presence.ts`

Uses Redis TTL keys to detect disconnected users across multiple homebase instances:

- On connect: `SAGE3:SOCKET:PRESENCE:<socketId>:<userId>` set with 30-second TTL; Presence document set to `status:'online'`
- Every 15 s: key refreshed (keepalive)
- On disconnect: key deleted immediately
- Background check every 30 s (`AllUserCheck`): for every user with `status:'online'`, scans for their Redis keys — if none found (all expired), sets `status:'offline'`

This works across instances because Redis is shared.

---

## Request Lifecycle — Full Traces

### SUB (subscribe) — client subscribes to a board's apps

```
Client → WebSocket: { id:'sub-1', route:'/api/apps', method:'SUB', body:{boardId:'board123'} }

homebase main.ts:156
  socket.on('message') → wsAPIRouter()

homebase wsRouter.ts
  route '/apps' → AppsCollection.wsRouter(socket, message, user, cache)

backend SAGEWSRouter.ts (SUB case)
  checkPermissionsWS(user, 'SUB', 'APPS')  ✓
  parse query: boardId = 'board123'
  AppsCollection.subscribeByQuery('boardId', 'board123', callback)

backend SAGECollection.ts
  _collection.subscribeToQuery('boardId', 'board123', callback)

sagebase SBCollection.ts
  redis.duplicate() → new Redis connection
  pSubscribe('SAGE3:DB:APPS:*')
  on each message: filter docs where data.boardId === 'board123'
  return unsubscribeFn

backend SAGEWSRouter.ts
  cache.add('sub-1', [unsubscribeFn])
  immediately sends initial snapshot to client

Future: any UPDATE to an APPS doc
  SBDocumentRef writes to Redis
  SBPubSub publishes to SAGE3:PUBSUB:APPS
  SBCollection subscriber callback fires
  filters for boardId match
  socket.send({ id:'sub-1', event:{ type:'UPDATE', col:'APPS', doc:[...] } })

Client UNSUB:
  cache.delete('sub-1') → unsubscribeFn() → Redis connection closed
```

### PUT (update) — client updates an app, all subscribers notified

```
Client → HTTP: PUT /api/apps/app123  body:{ 'state.position': {x:100,y:200} }

homebase httpRouter
  AppsCollection.router() (Express)
  checkPermissionsREST('APPS') middleware ✓

backend SAGECollection.ts
  update('app123', userId, { 'state.position': {x:100,y:200} })

sagebase SBDocumentRef.update()
  1. fetch current doc from Redis (SAGE3:DB:APPS:app123)
  2. merge patch into data field
  3. set _updatedAt, _updatedBy
  4. write SAGE3:DB:APPS:app123 back to Redis
  5. SBPubSub.publish('APPS', { type:'UPDATE', col:'APPS', doc:[updatedDoc] })

Redis PubSub broadcasts to ALL homebase instances
  Each instance's SBCollection subscriber callback fires
  Filters subscriptions matching app123 / boardId
  Pushes to each subscribed WebSocket client

HTTP response: 200 + updated document
```

### File upload — end-to-end

```
Client → POST /api/assets/upload (multipart, authenticated)

homebase-files uploadHandler.ts
  multer stores file(s) to local filesystem

  MessageCollection.add('Uploading Assets')
    → writes to shared Redis
    → homebase PubSub fires
    → subscribed clients receive notification

  for each file:
    AssetsCollection.metadataFile() → MetadataProcessor BullMQ job
      exiftool extracts EXIF
    AssetsCollection.processFile() → ImageProcessor or PDFProcessor BullMQ job
      sharp generates thumbnails (images)
      pdfjs converts pages to images (PDFs)

  MessageCollection.add('Assets Ready', close:true)

  AssetsCollection.addBatch([assetSchemas])
    → writes to shared Redis
    → PubSub fires
    → clients subscribed to ASSETS receive new documents

Response: { ids: ['asset-uuid-1', ...] }
```

---

## Horizontal Scaling

### What scales and what doesn't

| Component | Scales? | Why |
|-----------|---------|-----|
| homebase | ✅ Yes | Stateless; all state in Redis |
| homebase-files | ⚠️ Partial | Scales compute, but requires shared filesystem for files |
| homebase-yjs | ❌ No | Yjs docs are in-memory with no shared backend |

### How multiple homebase instances coordinate

All instances connect to the same Redis. Because SBPubSub uses `pSubscribe` on each instance independently, a write on Instance 2 triggers PubSub callbacks on **all** instances including Instance 1 — which then pushes to its own connected WebSocket clients. Sessions are stored in Redis so any instance can validate any session.

### Presence across instances

Uses Redis TTL keys (30 s TTL, refreshed every 15 s). A background check every 30 s scans Redis for expired keys and marks offline users. Works correctly across instances because Redis is the shared source of truth.

---

## Data Model

All documents share a base shape:

```typescript
{
  _id: string;          // UUID
  _createdAt: number;   // epoch ms
  _updatedAt: number;   // epoch ms
  _updatedBy: string;   // user ID
  _createdBy: string;   // user ID
  data: T;              // collection-specific payload
}
```

### Collections (13 total)

| Collection | TTL | Cascade on delete | Queryable fields |
|------------|-----|-------------------|-----------------|
| APPS | — | — | roomId, boardId, type |
| BOARDS | — | Deletes APPS, ANNOTATIONS, INSIGHT | roomId |
| ROOMS | — | Deletes BOARDS, ASSETS, PLUGINS, ROOMMEMBERS | — |
| USERS | — | — | — |
| ASSETS | — | — | file, room, owner |
| PRESENCE | — | — | userId |
| MESSAGE | **60 s** | — | userId |
| PLUGINS | — | — | — |
| ANNOTATIONS | — | — | boardId |
| LINKS | — | — | boardId |
| ROOMMEMBERS | — | — | roomId |
| INSIGHT | — | — | boardId |
| KERNEL | — | — | — |

### Key schemas

**App** — most important document type
```typescript
{
  title: string;
  roomId: string;
  boardId: string;
  position: { x, y, z };
  size: { width, height, depth };
  rotation: { x, y, z };
  type: AppName;        // 'Stickie' | 'PDFViewer' | 'Chat' | ...
  state: AppState;      // app-specific typed state
  raised: boolean;
  dragging: boolean;
  pinned: boolean;
  sourceApps?: string[];
}
```

**Room**: `{ name, description, color, ownerId, isPrivate, privatePin, isListed }`

**Board**: `{ name, description, color, roomId, ownerId, isPrivate, privatePin, code, whiteboardLines, executeInfo }`

**Presence**: `{ userId, roomId, boardId, cursor: {x,y}, viewport: {..}, status: 'online'|'offline', following: string }`

**Asset**: `{ originalfilename, mimetype, filename, fullpath, size, date, derived, metadata, room, owner }`

**Message**: `{ type, payload, close, userId }` — TTL 60 s, used for upload progress notifications

---

## Frontend Architecture (webapp)

### Routes
```
/                         → Login
/home                     → Room/board browser
/home/room/:roomId        → Room view
/board/:roomId/:boardId   → Board canvas (main experience)
/admin                    → Admin panel
/createuser               → Account setup
/enter/:roomId/:boardId   → Direct board join link
```

### Provider tree
```
ChakraProvider
  UserSettingsProvider          (localStorage-persisted user prefs)
    AuthProvider
      UserProvider
        [Routes]
          BoardPage:
            CursorBoardPositionProvider   (cursor position via refs, zero re-renders)
              YjsProvider                 (Yjs connection for collaborative apps)
                [Apps on board]
```

### Board Canvas

The board is **not** a `<canvas>` element — it uses **CSS transforms** on a giant `Box` (div).

- **Board dimensions**: 3,000,000 × 3,000,000 pixels
- **Zoom range**: 0.1× – 6×
- **Pan/zoom**: mouse wheel (Ctrl/Cmd = zoom, otherwise pan), touchpad (two-finger pan + pinch), touch screen (single-finger pan, two-finger pinch with deadzone and ratio clamping)
- **State**: `localBoardPosition: { x, y, scale }` tracked locally, synced to UIStore after a **250ms debounce**
- **File**: `apps/webapp/src/app/pages/board/layers/background/BackgroundLayer.tsx`

### AppWindow & Drag/Resize

Each app on the board is wrapped in an `AppWindow` component backed by **`react-rnd`**:

- Min size: 200×100 px; Max size: 8192×8192 px
- Drag/resize updates local `{pos, size}` state, then commits to the server **on drop** via `useAppStore.update()`
- Pinned apps skip position updates; locked board prevents all movement
- Selected apps show a blue border and raised z-index
- **RndSafety workaround**: sets `rndSafeForAction` flag after 200ms post-board-sync to prevent apps disappearing during zoom/pan
- **File**: `libs/applications/src/lib/components/AppWindow/AppWindow.tsx`

### App Rendering

`Apps.tsx` throttles the app list (250ms), maps each to its registered component, wraps in `AppWindow` and `ErrorBoundary`. Apps are **memoized** to prevent re-renders when their data hasn't changed.

### Board Entry / Exit Lifecycle

**On entering** (`/board/:roomId/:boardId`):
1. Parallel: subscribe assets, presence, users
2. Sequential: rooms, boards (by roomId), **apps (by boardId)**, insights, plugins, links
3. Update own presence, add to recent boards, clear selected app

**On leaving**:
1. `unsubBoard()` — unsubs from app updates; **auto-deletes the user's Screenshare apps**
2. Clear own presence
3. Unsub insights; remove event listeners

### Zustand Stores

One per collection. Pattern: initial HTTP snapshot + WS subscription. Store patches array in-place on UPDATE messages.

Stores: `app`, `board`, `room`, `user`, `asset`, `presence`, `message`, `annotation`, `plugin`, `insight`, `link`, `ui`, `kernel`, `config`, `twilio`

**UIStore** is local-only (no WebSocket): tracks canvas scale/position, selection, interaction flags, drawing state.

### WebSocket Client

**File**: `libs/frontend/src/lib/api/ws/api-socket.ts`

Singleton. Connects to `ws[s]://host/api`. Routes messages by `msg.id` to subscription callbacks or REST promise resolvers. **No automatic reconnect** — a dropped connection requires a page reload.

### Presence & Cursors

Cursor position tracked via **refs** in `CursorBoardPositionProvider` (zero re-renders). Presence updates sent on position change with no transport-level throttle.

### User Settings

Persisted in `localStorage` under `'s3_user_settings'`. Includes: `showCursors`, `showViewports`, `showAppTitles`, `showLinks`, `primaryActionMode`, `aiModel` (`llama`|`openai`|`azure`), `uiScale`.

### Toolbar & Context Menu

**App Toolbar**: shown when an app is selected; position draggable; per-app toolbar from Applications registry.

**Board Context Menu**: right-click triggered; auto-repositions if off-screen; sub-menus: Users, Screenshare, Applications, Plugins, Assets, Kernels, Navigation.

---

## Applications System (libs/applications)

### How apps work

Each app is a self-contained module registered in a central map:
```typescript
{
  name: AppName;
  AppComponent: React.FC<AppProps>;
  ToolbarComponent: React.FC<AppProps>;
  GroupedToolbarComponent: React.FC<{ apps }>;
}
```

Apps read/update state via:
```typescript
const s = props.data.state as MyAppState;
updateState(props._id, { key: newValue });        // single app
updateStateBatch([{ id, state }]);                // multiple apps
```

### Officially Supported Apps (21)

| App | Description |
|-----|-------------|
| AssetLink | Download button for an asset manager file |
| BoardLink | Miniature preview of another board with navigation |
| Calculator | Basic arithmetic with history |
| Chat | Real-time messaging + AI chat (multi-modal) |
| Clock | Current time for any timezone |
| CodeEditor | Collaborative multi-language code editor |
| CSVViewer | Tabular viewer for CSV files (virtually rendered) |
| DeepZoomImage | High-resolution tiled image viewer |
| Drawing | Collaborative drawing via TLDraw (Yjs-backed) |
| ImageViewer | Image display with multi-resolution support |
| Map | Interactive map via MapGL with data layer overlays |
| Notepad | Rich-text collaborative editor (Yjs-backed) |
| PDFViewer | PDF viewer for assets |
| Poll | Real-time voting with live result graphs |
| SageCell | Computational code cell backed by a Jupyter kernel |
| Screenshare | Screen/window sharing with auto quality adjustment |
| Stickie | Virtual sticky notes with color options |
| Timer | Synchronized countdown timer |
| VideoViewer | Web-compatible video playback |
| WebpageLink | URL metadata card with multiple open options |
| Webview | Embedded browser on the canvas |

> **`libs/applications` contains more code than this list.** Apps not listed here are dead/unused — don't assume they work.

**AI-enabled** (can send context to Seer): `Chat`, `ImageViewer`, `PDFViewer`, `Stickie`, `CodeEditor`, `Webview`, `Map`, `SageCell`

**Yjs-backed** (require homebase-yjs): `Drawing`, `Notepad`, `CodeEditor`, `Annotations`

### Scaffolding a new app (tools/generators)

An NX generator automates all the boilerplate for adding a new app:

```bash
nx workspace-generator newapp
# or with args:
nx workspace-generator newapp --name MyApp --username yourname --statetype string --statename myField --val ""
```

What it does automatically:
1. Copies template files into `libs/applications/src/lib/apps/<AppName>/`
2. Adds the app name to `libs/applications/src/lib/apps.json`
3. Regenerates `apps.ts` — the central `Applications` registry map
4. Regenerates `types.ts` — the `AppState` and `AppName` union types
5. Regenerates `initialValues.ts` — the default state for each app

**Important**: `apps.ts`, `types.ts`, and `initialValues.ts` are **generated files** — do not edit them by hand. They are rebuilt from `apps.json` by the generator. If you add an app manually without the generator, run `nx workspace-generator regen` afterward to sync these files.

---

## Plugin System (libs/sageplugin)

Third-party apps run inside an `<iframe>` in a `PluginApp` instance. Communication via `window.postMessage()`.

```typescript
const plugin = new SAGE3Plugin<MyState>();
plugin.subscribeToUpdates((state, userId) => { /* handle push */ });
plugin.update({ state: { myField: newValue } });
```

Lifecycle: PluginApp created → iframe loads → parent sends `type:'init'` → plugin subscribes → plugin sends `type:'update'` → SAGE3 broadcasts to all clients.

---

## AI / Python Services

### seer/ — Main AI service (FastAPI, port 9999)

Proxied via homebase `/api/agents/*`. Uses LangChain.

| Endpoint | Purpose |
|----------|---------|
| `POST /ask` | Chat / general Q&A |
| `POST /code` | Code generation |
| `POST /image` | Image analysis (vision) |
| `POST /pdf` | PDF Q&A |
| `POST /web` | Web content analysis |
| `POST /webshot` | Screenshot analysis |
| `POST /mesonet` | Sensor/weather data queries |
| `GET /status` | Health check |

### foresight/ — Jupyter kernel proxy

Proxied via homebase `/api/kernels/*` with SSE streaming support. Used by SageCell.

### sage_seer/ — Advanced agent framework

Uses LangGraph for multi-step agents. Relationship to `seer/` unclear — may be replacement or parallel. Written by a different team member; not fully documented.

---

## Configuration

`webstack/sage3-dev.hjson` / `webstack/sage3-prod.hjson`

```hjson
{
  production: false,
  port: 3000, port_yjs: 3001, port_files: 3002,
  serverName: "My SAGE3 Hub",
  root: "...", public: "...", assets: "...",

  redis:   { url: "redis://localhost:6379" },
  kernels: { url: "http://localhost:8888" },
  agents:  { url: "http://localhost:9999" },

  fluentd: { server, port, databaseLevel: "partial" },
  webserver: { logLevel: "partial", uploadLimit: "5GB" },

  services: {
    twilio: { accountSid, apiKey, apiSecret },
    openai: { apiKey, model, label },
    llama:  { url, model, apiKey, label, max_tokens },
    azure:  { text, embedding, transcription, reasoning, vision }
  },

  features: {
    plugins: true,
    apps: ["Stickie", "PDFViewer", ...]
  },

  auth: {
    sessionSecret: "...",
    sessionMaxAge: 691200000,
    strategies: ["guest", "jwt", "google"],
    admins: ["admin@example.com"],
    guestConfig:  { routeEndpoint: "/auth/guest" },
    googleConfig: { clientID, clientSecret, callbackURL },
    jwtConfig:    { issuer, audience, publicKey },
  },

  namespace: "uuid-v5-namespace-for-this-deployment"
}
```

---

## Electron Client (clients/electron)

Wraps the React webapp in an Electron BrowserWindow:
- Configurable server URL; `sage3://` URI scheme for deep-linking to a room/board
- IPC bridge for screen capture, auto-update, bookmark storage, opt-in analytics, window state persistence
- UI scale mirrors `uiScale` user setting to native window zoom
- Launch args (via `commander`): server URL, room/board IDs

---

## Known Limitations & Tech Debt

Documented intentionally — knowing rough edges is as important as knowing the happy path.

1. **Message overhead**: Pub/Sub broadcasts to all subscribers on every write. With many users on a busy board this creates noticeable overhead. Not suitable for large concurrent user counts without architectural changes.

2. **No WS auto-reconnect**: `api-socket.ts` has no reconnect logic. Dropped connection = page reload required.

3. **Yjs single instance**: homebase-yjs stores documents in-memory. Adding `y-redis` or similar would be needed to scale.

4. **Auth fragility**: Role is derived from auth provider name (hardcoded map), not a role field in the database. Mixing session + JWT can cause conflicts. The WebRTC endpoint has no authentication at all.

5. **NX coupling**: Build pipeline deeply depends on NX 14. The team wants to remove it but it's embedded throughout.

6. **Dead app code**: `libs/applications` contains apps beyond the 21 supported. Do not assume unlisted apps are functional.

7. **AI services ownership gap**: Python services (`seer/`, `foresight/`, `sage_seer/`) were written by a different team member. `seer/` vs `sage_seer/` relationship is undocumented.

8. **Redis as sole data store**: No backup DB. Redis restart loses all session data.

9. **Local file storage**: homebase-files stores uploads on local disk. Horizontal scaling requires a shared filesystem.

10. **Presence throttling**: Cursor/presence has no transport-level throttle — only application-level gating.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `webstack/apps/homebase/src/main.ts` | Main server entry — startup sequence, WS auth |
| `webstack/apps/homebase/src/api/collections/` | All 13 collection definitions |
| `webstack/apps/homebase/src/api/routers/custom/` | kernels proxy, agents proxy, NLP |
| `webstack/apps/homebase-files/src/main.ts` | File server entry |
| `webstack/apps/homebase-files/src/api/uploadHandler.ts` | Upload + BullMQ pipeline |
| `webstack/apps/homebase-yjs/src/main.ts` | Yjs + WebRTC server |
| `webstack/libs/sagebase/src/lib/core/SAGEBase.ts` | SAGEBase singleton |
| `webstack/libs/sagebase/src/lib/modules/database/SBCollection.ts` | Redis doc store |
| `webstack/libs/sagebase/src/lib/modules/auth/SBAuth.ts` | Auth + session setup |
| `webstack/libs/sagebase/src/lib/modules/auth/adapters/` | Per-strategy adapters |
| `webstack/libs/backend/src/lib/generics/SAGECollection.ts` | Collection base class |
| `webstack/libs/backend/src/lib/generics/SAGEWSRouter.ts` | WS dispatcher |
| `webstack/libs/backend/src/lib/generics/permissions.ts` | RBAC rules |
| `webstack/libs/backend/src/lib/utils/presence.ts` | Online/offline tracking |
| `webstack/libs/backend/src/lib/utils/subscription-cache.ts` | Per-socket sub tracking |
| `webstack/libs/shared/src/lib/types/` | All shared TypeScript types |
| `webstack/libs/shared/src/lib/types/server/serverconfig.ts` | ServerConfiguration type |
| `webstack/apps/webapp/src/app/pages/board/` | Board page (canvas, layers, lifecycle) |
| `webstack/libs/applications/src/lib/components/AppWindow/AppWindow.tsx` | App drag/resize wrapper |
| `webstack/libs/applications/src/lib/apps/` | Individual app implementations |
| `webstack/libs/frontend/src/lib/stores/` | Zustand stores (one per collection) |
| `webstack/libs/frontend/src/lib/stores/ui.ts` | Local UI state (canvas, selection) |
| `webstack/libs/frontend/src/lib/api/ws/api-socket.ts` | WebSocket client singleton |
| `webstack/libs/frontend/src/lib/providers/useCursorBoardPosition.tsx` | Cursor coords |
| `webstack/libs/frontend/src/lib/providers/useUserSettings.tsx` | User preferences |
| `webstack/libs/sageplugin/src/lib/sageplugin.ts` | Plugin iframe lib |
| `webstack/sage3-dev.hjson` | Dev configuration |
| `seer/main.py` | AI service entry point |

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 |
| Frontend state | Zustand |
| UI components | Chakra UI |
| Router | React Router v6 |
| Drag/resize | react-rnd |
| Collaborative drawing | TLDraw |
| Collaborative sync | Yjs (CRDT) |
| Build system | NX 14 + Webpack |
| Backend framework | Express.js |
| Database | Redis (document store via SAGEBase) |
| Query indexing | RediSearch |
| Job queue | BullMQ |
| Real-time | WebSockets (ws library) + Redis PubSub |
| Auth | Passport.js (guest, JWT RS256, Google, Apple, CILogon) |
| Permissions | CASL |
| File processing | sharp (images), pdfjs (PDFs), multer (uploads), exiftool (EXIF) |
| AI services | FastAPI + LangChain + LangGraph (Python) |
| Video | Twilio + WebRTC (signaling via homebase-yjs) |
| Desktop | Electron |
| Logging | Fluentd |
| Deployment | Docker / Kubernetes |
| Package manager | Yarn |
