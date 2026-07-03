# PluginApp Declarative Toolbar Protocol — Design

## Context

`PluginApp` is SAGE3's generic app type for third-party plugins: a bundle
uploaded via `POST /api/plugins/upload` is extracted to
`dist/apps/homebase/plugins/apps/<roomId>_<pluginName>/` and served as a
sandboxed `<iframe>` (`libs/applications/src/lib/apps/PluginApp/PluginApp.tsx:70-76`).
The iframe communicates with SAGE3 only via `postMessage` — `init`/`update`
messages flow in, an `update` message (containing a partial state patch)
flows out (`PluginApp.tsx:35-63`; the plugin-side counterpart is
`libs/sageplugin/src/lib/sageplugin.ts`).

Every native SAGE3 app (Stickie, Timer, Chat, ...) additionally defines a
`ToolbarComponent` — a small React component that SAGE3 renders in its own
UI chrome, next to the app, whenever exactly one instance is selected
(`apps/webapp/src/app/pages/board/layers/ui/components/AppToolbar.tsx:784-828`,
`:1043`). It receives the full live `App` document as props and writes state
changes directly via a Zustand hook: `useAppStore(state => state.updateState)`,
called as `updateState(props._id, partialState)` — a shallow merge, PUT to
`/apps/:id`, gated only by the generic `SAGE3Ability.canCurrentUser('update',
'apps')` permission check (`libs/frontend/src/lib/stores/app.ts:90-102`). This
pattern is identical across every native app's toolbar (Stickie.tsx:275,
Timer.tsx:108-114, Chat.tsx:467-474, etc.).

`PluginApp.ToolbarComponent` is currently a stub returning `null`
(`PluginApp.tsx:83-85`). There is no mechanism today for a plugin's own
uploaded bundle to influence what renders in SAGE3's native toolbar area —
that component is compiled into SAGE3's own webapp bundle at build time
(registered in `libs/applications/src/lib/apps.ts:217-221`), while the
plugin's code only ever runs inside the sandboxed iframe. This gap was
discovered concretely while building a self-service CTFd dashboard plugin: it
needed a native "Reconfigure" control, and had to fall back to an in-canvas
gear icon instead.

## Goal

Let a `PluginApp` instance's own uploaded content declare a small set of
native toolbar buttons, rendered by SAGE3's real `ToolbarComponent`, without
granting the plugin any capability it doesn't already have.

## Why this is safe

A plugin author who can upload a bundle already has full JavaScript execution
inside their own iframe, and can already call `SAGE3Plugin.update()` (which
`postMessage`s an arbitrary state patch to SAGE3's main process) from that
iframe at any time, for any reason — a user click, a timer, page load. This
protocol adds no new capability: it only lets the plugin pre-declare a small,
fixed menu of "apply this exact state patch" actions that SAGE3 renders as
native buttons instead of requiring in-canvas UI. Concretely:

- The declaration is pure data (JSON-serializable primitives), never code —
  no `eval`, no function values, nothing resembling `executeInfo`'s
  server-executed-function convention used elsewhere in the codebase
  (`Counter.tsx:52-59`).
- Button labels and tooltips render through normal React props (auto-escaped
  by JSX) — never `dangerouslySetInnerHTML`.
- Icons are chosen from a fixed whitelist of already-bundled `react-icons`
  components — no dynamic icon names, URLs, or image loading.
- Every click still goes through the exact same `updateState(id, patch)` →
  `SAGE3Ability.canCurrentUser('update', 'apps')` path every other native
  toolbar button uses — the clicking user's own permissions are the actual
  gate, not anything the plugin declared.
- The array is capped (5 entries) and validated defensively — a malformed or
  oversized declaration is silently ignored (renders nothing) rather than
  thrown.

## Design

### 1. Declaration shape

A reserved, optional top-level key in `PluginApp`'s state,
`__toolbar`, alongside whatever data fields the plugin's own iframe content
uses. `PluginApp`'s schema is `z.any()` (`index.ts:16`) — this spec adds a
loosely-typed shape checked at read time in the toolbar component, not a
schema-level change:

```typescript
// libs/applications/src/lib/apps/PluginApp/toolbarTypes.ts (new file)
export const TOOLBAR_ICONS = ['settings', 'reset', 'refresh', 'edit', 'delete'] as const;
export type ToolbarIconName = (typeof TOOLBAR_ICONS)[number];

export type PluginToolbarButton = {
  id: string; // unique within the array; used as React key
  label: string; // plain text, rendered as button label
  icon?: ToolbarIconName; // optional; omit for a text-only button
  tooltip?: string; // optional; falls back to label if omitted
  patch: Record<string, string | number | boolean | null>; // shallow state patch
};

export const MAX_TOOLBAR_BUTTONS = 5;
export const MAX_LABEL_LENGTH = 40;
export const MAX_TOOLTIP_LENGTH = 120;
```

A plugin sets this once, typically on successful setup, via its normal
`SAGE3Plugin.update()` call — no new plugin-side API:

```typescript
// example, from inside a plugin's own iframe code
plugin.update({
  registered: true,
  __toolbar: [
    { id: 'reconfigure', label: 'Reconfigure', icon: 'settings', patch: { registered: false } },
  ],
});
```

### 2. Validation

A pure function, unit-tested in isolation, used by `ToolbarComponent`:

```typescript
// libs/applications/src/lib/apps/PluginApp/toolbarTypes.ts (continued)
export function parseToolbarButtons(raw: unknown): PluginToolbarButton[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: PluginToolbarButton[] = [];
  for (const item of raw) {
    if (result.length >= MAX_TOOLBAR_BUTTONS) break;
    if (!item || typeof item !== 'object') continue;
    const { id, label, icon, tooltip, patch } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    if (typeof label !== 'string' || label.length === 0 || label.length > MAX_LABEL_LENGTH) continue;
    if (icon !== undefined && !TOOLBAR_ICONS.includes(icon as ToolbarIconName)) continue;
    if (tooltip !== undefined && (typeof tooltip !== 'string' || tooltip.length > MAX_TOOLTIP_LENGTH)) continue;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) continue;
    const patchEntries = Object.entries(patch as Record<string, unknown>);
    if (patchEntries.some(([, v]) => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) continue;
    seen.add(id);
    result.push({
      id,
      label,
      icon: icon as ToolbarIconName | undefined,
      tooltip: tooltip as string | undefined,
      patch: patch as PluginToolbarButton['patch'],
    });
  }
  return result;
}
```

Malformed entries are dropped individually (one bad button doesn't blank the
whole toolbar); a non-array or missing `__toolbar` yields an empty array,
i.e. today's `null` behavior is preserved exactly for plugins that don't use
this.

### 3. `ToolbarComponent`

Replaces the stub in `PluginApp.tsx:82-85`:

```typescript
function ToolbarComponent(props: App): JSX.Element | null {
  const updateState = useAppStore((state) => state.updateState);
  const buttons = parseToolbarButtons((props.data.state as AppState).__toolbar);
  if (buttons.length === 0) return null;

  return (
    <ButtonGroup size="xs" isAttached>
      {buttons.map((btn) => (
        <Tooltip key={btn.id} label={btn.tooltip ?? btn.label} placement="top">
          <Button onClick={() => updateState(props._id, btn.patch)} leftIcon={btn.icon ? ICONS[btn.icon] : undefined}>
            {btn.label}
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  );
}
```

`ICONS` is a local `Record<ToolbarIconName, JSX.Element>` mapping each
whitelisted name to an already-imported `react-icons/md` component (e.g.
`settings` → `MdSettings`, `reset`/`refresh` → `MdReplay`/`MdRefresh`, `edit`
→ `MdEdit`, `delete` → `MdDelete`) — matching the icon-import convention every
other toolbar in the codebase already uses (`Stickie.tsx:12`).

`GroupedToolbarComponent` (multi-select) is unchanged — stays `() => null`.
Not requested, and a shared-patch semantic across heterogeneous plugin
instances isn't well-defined enough to design here.

### 4. Testing

- Unit tests for `parseToolbarButtons`: valid array passes through; caps at
  5; drops entries with bad `id`/`label`/`icon`/`tooltip`/`patch` types
  individually; non-array/`undefined` input yields `[]`; duplicate `id`s —
  second one dropped; `patch` containing a nested object/array/function is
  rejected.
- Component test for `ToolbarComponent`: renders nothing when `__toolbar` is
  absent (regression check — today's behavior for every existing plugin);
  renders one button per valid declared entry; clicking a button calls
  `updateState` with exactly that button's `patch` and the app's `_id`.

### 5. Out of scope

- No change to `PluginApp`'s zod schema (stays `z.any()` — this is a
  read-time convention, not a schema-enforced contract).
- No new plugin-side SDK method — plugins already have `update()`.
- No `GroupedToolbarComponent` support.
- No support for buttons that need a value the plugin doesn't already know
  at declare-time (e.g. a text input, a confirmation dialog) — every action
  is a fixed, pre-declared patch. A plugin needing a dynamic control keeps
  building it in-canvas, same as today.
