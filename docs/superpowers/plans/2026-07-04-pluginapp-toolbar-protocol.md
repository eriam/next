# PluginApp Declarative Toolbar Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `PluginApp` instance's own uploaded content declare a small set of native toolbar buttons, rendered by SAGE3's real `ToolbarComponent`, without granting the plugin any capability it doesn't already have.

**Architecture:** A reserved, optional `__toolbar` array in `PluginApp`'s free-form state describes buttons (label, whitelisted icon, tooltip, and a fixed JSON state-patch to apply on click). A pure validation function (`parseToolbarButtons`) defensively parses and caps this array. A new, dependency-light `PluginAppToolbar.tsx` (currently `PluginApp.tsx`'s stub `ToolbarComponent` returning `null`) reads it and renders native Chakra buttons that call the same `useAppStore().updateState(id, patch)` every other native app's toolbar already uses. `ToolbarComponent` is split into its own file rather than left inline in `PluginApp.tsx` because `PluginApp.tsx`'s existing `AppComponent` pulls in `AppWindow` (`libs/applications/src/lib/components/AppWindow/AppWindow.tsx`), which itself imports several more `@sage3/frontend` hooks transitively (e.g. `WindowTitle.tsx`'s `useUserSettings`) — testing `ToolbarComponent` from the same file would drag that whole chain into the test's module graph for no reason.

**Tech Stack:** TypeScript, React, Chakra UI, Zustand (`useAppStore`), Jest + ts-jest + `@testing-library/react` (new jsdom wiring for `libs/applications`, which today has an Nx test target declared in `workspace.json` but no working jest config).

## Global Constraints

- Icon whitelist is exactly: `'settings' | 'reset' | 'refresh' | 'edit' | 'delete'` — no other values accepted.
- `MAX_TOOLBAR_BUTTONS = 5`, `MAX_LABEL_LENGTH = 40`, `MAX_TOOLTIP_LENGTH = 120` — exact values, buttons/labels/tooltips beyond these are dropped or rejected per the spec.
- A button's `patch` values must each be `string | number | boolean | null` — never a nested object, array, or function. Any button with a non-conforming `patch` is dropped entirely (not partially applied).
- Malformed individual button entries are dropped silently (skip that entry, keep parsing the rest) — never throw, never blank the whole toolbar for one bad entry.
- A missing/non-array `__toolbar` must yield an empty array — today's `null`-toolbar behavior is preserved exactly for every plugin that doesn't use this.
- Every button click calls the existing `updateState(props._id, patch)` — no new update pathway, no bypass of `SAGE3Ability.canCurrentUser('update', 'apps')`.
- `GroupedToolbarComponent` (multi-select) is explicitly out of scope — stays `() => null`, unchanged.
- No change to `PluginApp`'s zod schema (stays `z.any()` in `libs/applications/src/lib/apps/PluginApp/index.ts`) — this is a read-time convention, not a schema-enforced contract.
- No new plugin-side SDK method — plugins already have `SAGE3Plugin.update()` from `libs/sageplugin`.

---

## File Structure

- Create `libs/applications/src/lib/apps/PluginApp/toolbarTypes.ts` — types, constants, and the `parseToolbarButtons` validator. One responsibility: turn untrusted `state.__toolbar` data into a safe, bounded list of buttons.
- Create `libs/applications/src/lib/apps/PluginApp/toolbarTypes.spec.ts` — unit tests for the validator, in isolation from React.
- Create `libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.tsx` — the real `ToolbarComponent`, self-contained (only depends on `@chakra-ui/react`, `react-icons/md`, `@sage3/frontend`'s `useAppStore`, and `./toolbarTypes`).
- Create `libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.spec.tsx` — component test, using `@testing-library/react`.
- Modify `libs/applications/src/lib/apps/PluginApp/PluginApp.tsx` — replace the stub `ToolbarComponent` function with an import of the new `PluginAppToolbar.tsx`; no other function in this file changes.
- Create `libs/applications/jest.config.js` — wires up the Nx test target that `workspace.json` already declares (`libs/applications/jest.config.js`) but that doesn't exist yet today.
- Create `libs/applications/tsconfig.spec.json` — mirrors `libs/sageplugin/tsconfig.spec.json`'s existing pattern.
- Create `libs/applications/src/test-utils/cssMock.js` — trivial stub so Jest can resolve `PluginApp.tsx`'s `import './styling.css'` (Jest can't parse CSS natively).
- Modify root `webstack/package.json` — add `jest-environment-jsdom` as a devDependency (Jest 28 no longer bundles a jsdom environment; this repo currently has none installed anywhere).

---

### Task 1: Toolbar button validator, with working test infrastructure for `libs/applications`

**Files:**
- Create: `webstack/libs/applications/src/lib/apps/PluginApp/toolbarTypes.ts`
- Create: `webstack/libs/applications/src/lib/apps/PluginApp/toolbarTypes.spec.ts`
- Create: `webstack/libs/applications/jest.config.js`
- Create: `webstack/libs/applications/tsconfig.spec.json`
- Create: `webstack/libs/applications/src/test-utils/cssMock.js`
- Modify: `webstack/package.json` (add devDependency)

**Interfaces:**
- Produces: `TOOLBAR_ICONS: readonly ['settings', 'reset', 'refresh', 'edit', 'delete']`, `type ToolbarIconName = (typeof TOOLBAR_ICONS)[number]`, `type PluginToolbarButton = { id: string; label: string; icon?: ToolbarIconName; tooltip?: string; patch: Record<string, string | number | boolean | null> }`, `MAX_TOOLBAR_BUTTONS = 5`, `MAX_LABEL_LENGTH = 40`, `MAX_TOOLTIP_LENGTH = 120`, `function parseToolbarButtons(raw: unknown): PluginToolbarButton[]` — all exported from `toolbarTypes.ts`. Task 2 imports these directly.

- [ ] **Step 1: Add the missing jsdom test environment dependency**

The repo has `jest` 28.1.3 and `ts-jest` 28.0.8 at the root, but no jsdom environment package anywhere (Jest 28 requires it as a separate install for any browser-like test). Edit `webstack/package.json` — find the `"jest-environment-node"` line in `devDependencies` and add a new line directly after it:

```json
    "jest-environment-node": "^28.1.3",
    "jest-environment-jsdom": "^28.1.3",
```

- [ ] **Step 2: Install the new dependency**

Run: `cd webstack && yarn install`
Expected: completes without error; `yarn.lock` gains a `jest-environment-jsdom@^28.1.3` entry.

- [ ] **Step 3: Create the CSS mock used by the new jest config**

Create `webstack/libs/applications/src/test-utils/cssMock.js`:

```js
module.exports = {};
```

- [ ] **Step 4: Create the jest config that the Nx workspace already expects**

`webstack/workspace.json`'s `projects.applications.architect.test.options.jestConfig` already points at `libs/applications/jest.config.js` — that file has never existed, so the target only ever passed trivially via `passWithNoTests: true`. Create `webstack/libs/applications/jest.config.js`:

```js
/* eslint-disable */
module.exports = {
  displayName: 'applications',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.spec.json',
    },
  },
  transform: {
    '^.+\\.[tj]sx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '\\.(css|less|scss)$': '<rootDir>/src/test-utils/cssMock.js',
  },
  coverageDirectory: '../../coverage/libs/applications',
};
```

- [ ] **Step 5: Create the spec tsconfig**

Create `webstack/libs/applications/tsconfig.spec.json` (mirrors `libs/sageplugin/tsconfig.spec.json` exactly, adjusted for this lib's own `tsconfig.json`):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": ["jest", "node"]
  },
  "include": [
    "jest.config.js",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/*.test.tsx",
    "**/*.spec.tsx",
    "**/*.test.js",
    "**/*.spec.js",
    "**/*.test.jsx",
    "**/*.spec.jsx",
    "**/*.d.ts"
  ]
}
```

- [ ] **Step 6: Write the failing tests for `parseToolbarButtons`**

Create `webstack/libs/applications/src/lib/apps/PluginApp/toolbarTypes.spec.ts`:

```typescript
import { parseToolbarButtons, MAX_TOOLBAR_BUTTONS, MAX_LABEL_LENGTH, MAX_TOOLTIP_LENGTH } from './toolbarTypes';

describe('parseToolbarButtons', () => {
  it('returns [] for undefined input', () => {
    expect(parseToolbarButtons(undefined)).toEqual([]);
  });

  it('returns [] for non-array input', () => {
    expect(parseToolbarButtons('not an array')).toEqual([]);
    expect(parseToolbarButtons({ id: 'x' })).toEqual([]);
    expect(parseToolbarButtons(null)).toEqual([]);
  });

  it('passes through a single valid button unchanged', () => {
    const input = [{ id: 'a', label: 'Reconfigure', icon: 'settings', tooltip: 'Change settings', patch: { registered: false } }];
    expect(parseToolbarButtons(input)).toEqual(input);
  });

  it('accepts a button with no icon and no tooltip', () => {
    const input = [{ id: 'a', label: 'Reset', patch: { count: 0 } }];
    expect(parseToolbarButtons(input)).toEqual(input);
  });

  it('caps at MAX_TOOLBAR_BUTTONS, keeping the first entries in order', () => {
    const input = Array.from({ length: MAX_TOOLBAR_BUTTONS + 3 }, (_, i) => ({
      id: `btn-${i}`,
      label: `Button ${i}`,
      patch: { n: i },
    }));
    const result = parseToolbarButtons(input);
    expect(result).toHaveLength(MAX_TOOLBAR_BUTTONS);
    expect(result.map((b) => b.id)).toEqual(input.slice(0, MAX_TOOLBAR_BUTTONS).map((b) => b.id));
  });

  it('drops a button with a non-string id', () => {
    const input = [{ id: 42, label: 'Bad', patch: {} }, { id: 'ok', label: 'Good', patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([{ id: 'ok', label: 'Good', patch: {} }]);
  });

  it('drops a button with an empty string id', () => {
    const input = [{ id: '', label: 'Bad', patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops the second button when two share the same id', () => {
    const input = [
      { id: 'dup', label: 'First', patch: { a: 1 } },
      { id: 'dup', label: 'Second', patch: { a: 2 } },
    ];
    expect(parseToolbarButtons(input)).toEqual([{ id: 'dup', label: 'First', patch: { a: 1 } }]);
  });

  it('drops a button with a missing label', () => {
    const input = [{ id: 'a', patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button with a label longer than MAX_LABEL_LENGTH', () => {
    const input = [{ id: 'a', label: 'x'.repeat(MAX_LABEL_LENGTH + 1), patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('accepts a label exactly MAX_LABEL_LENGTH long', () => {
    const label = 'x'.repeat(MAX_LABEL_LENGTH);
    const input = [{ id: 'a', label, patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([{ id: 'a', label, patch: {} }]);
  });

  it('drops a button with an icon not in the whitelist', () => {
    const input = [{ id: 'a', label: 'Bad', icon: 'trash-can', patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button with a tooltip longer than MAX_TOOLTIP_LENGTH', () => {
    const input = [{ id: 'a', label: 'Bad', tooltip: 'x'.repeat(MAX_TOOLTIP_LENGTH + 1), patch: {} }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button with a missing patch', () => {
    const input = [{ id: 'a', label: 'Bad' }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button whose patch is an array', () => {
    const input = [{ id: 'a', label: 'Bad', patch: [1, 2, 3] }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button whose patch contains a nested object value', () => {
    const input = [{ id: 'a', label: 'Bad', patch: { nested: { x: 1 } } }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button whose patch contains an array value', () => {
    const input = [{ id: 'a', label: 'Bad', patch: { list: [1, 2] } }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('drops a button whose patch contains a function value', () => {
    const input = [{ id: 'a', label: 'Bad', patch: { fn: () => true } }];
    expect(parseToolbarButtons(input)).toEqual([]);
  });

  it('accepts a patch with null, string, number, and boolean values', () => {
    const input = [{ id: 'a', label: 'Good', patch: { a: null, b: 'x', c: 1, d: true } }];
    expect(parseToolbarButtons(input)).toEqual(input);
  });

  it('skips a malformed entry but keeps parsing valid entries after it', () => {
    const input = [
      { id: 'bad', label: '', patch: {} },
      { id: 'good', label: 'Good', patch: { a: 1 } },
    ];
    expect(parseToolbarButtons(input)).toEqual([{ id: 'good', label: 'Good', patch: { a: 1 } }]);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd webstack && npx nx test applications`
Expected: FAIL — `Cannot find module './toolbarTypes' from 'toolbarTypes.spec.ts'` (the module doesn't exist yet).

- [ ] **Step 8: Implement `toolbarTypes.ts`**

Create `webstack/libs/applications/src/lib/apps/PluginApp/toolbarTypes.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * A plugin's uploaded iframe content can already trigger any state patch it
 * wants via SAGE3Plugin.update() (postMessage to the SAGE3 main process) —
 * this declarative protocol grants no new capability, it only lets a plugin
 * pre-declare a small, fixed menu of "apply this exact state patch" actions
 * so SAGE3 can render them as native toolbar buttons instead of requiring
 * in-canvas UI. Every value here is JSON data, never code: no eval, no
 * function values, no dynamic icon/URL loading.
 */

export const TOOLBAR_ICONS = ['settings', 'reset', 'refresh', 'edit', 'delete'] as const;
export type ToolbarIconName = (typeof TOOLBAR_ICONS)[number];

export type PluginToolbarButton = {
  id: string;
  label: string;
  icon?: ToolbarIconName;
  tooltip?: string;
  patch: Record<string, string | number | boolean | null>;
};

export const MAX_TOOLBAR_BUTTONS = 5;
export const MAX_LABEL_LENGTH = 40;
export const MAX_TOOLTIP_LENGTH = 120;

function isValidPatch(patch: unknown): patch is PluginToolbarButton['patch'] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  return Object.values(patch as Record<string, unknown>).every(
    (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
  );
}

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
    if (icon !== undefined && !(TOOLBAR_ICONS as readonly string[]).includes(icon as string)) continue;
    if (tooltip !== undefined && (typeof tooltip !== 'string' || tooltip.length > MAX_TOOLTIP_LENGTH)) continue;
    if (!isValidPatch(patch)) continue;

    seen.add(id);
    result.push({
      id,
      label,
      icon: icon as ToolbarIconName | undefined,
      tooltip: tooltip as string | undefined,
      patch,
    });
  }

  return result;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd webstack && npx nx test applications`
Expected: PASS — 20 tests, 0 failures.

- [ ] **Step 10: Commit**

```bash
cd webstack
git add package.json yarn.lock libs/applications/jest.config.js libs/applications/tsconfig.spec.json \
  libs/applications/src/test-utils/cssMock.js \
  libs/applications/src/lib/apps/PluginApp/toolbarTypes.ts \
  libs/applications/src/lib/apps/PluginApp/toolbarTypes.spec.ts
git commit -m "feat(applications): add PluginApp toolbar button validator

Also wires up libs/applications' jest test target (declared in
workspace.json but never given a working config until now)."
```

---

### Task 2: `PluginAppToolbar` component renders declared buttons

**Files:**
- Create: `webstack/libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.tsx`
- Create: `webstack/libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.spec.tsx`
- Modify: `webstack/libs/applications/src/lib/apps/PluginApp/PluginApp.tsx:82-85` (stub removal) and its imports

**Interfaces:**
- Consumes: `parseToolbarButtons`, `ToolbarIconName` from `./toolbarTypes` (Task 1); `useAppStore` from `@sage3/frontend` (existing, already used identically by every other native app's toolbar, e.g. `Stickie.tsx:255`: `const updateState = useAppStore((state) => state.updateState);`); `App` type from `../../schema`; `state as AppState` from `./index`.
- Produces: `export default function ToolbarComponent(props: App): JSX.Element | null` from `PluginAppToolbar.tsx` — consumed by `PluginApp.tsx`'s default export object. Nothing else consumes this later — this is the final task.

- [ ] **Step 1: Write the failing component test**

Create `webstack/libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.spec.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../../schema';

const mockUpdateState = jest.fn();

// `{ virtual: true }` is required: '@sage3/frontend' is a TS path alias
// (tsconfig.base.json), not a real resolvable module from this test file's
// location, and no moduleNameMapper for it exists in this repo's jest
// config today. Without `virtual: true`, jest.mock() throws "Cannot find
// module '@sage3/frontend'" before the factory is ever used.
jest.mock(
  '@sage3/frontend',
  () => ({
    useAppStore: (selector: (state: { updateState: typeof mockUpdateState }) => unknown) =>
      selector({ updateState: mockUpdateState }),
  }),
  { virtual: true }
);

import ToolbarComponent from './PluginAppToolbar';

function buildApp(state: Record<string, unknown>): App {
  return {
    _id: 'app-1',
    _createdAt: 0,
    _updatedAt: 0,
    _updatedBy: 'user-1',
    _createdBy: 'user-1',
    data: {
      title: 'Test Plugin',
      roomId: 'room-1',
      boardId: 'board-1',
      position: { x: 0, y: 0, z: 0 },
      size: { width: 100, height: 100, depth: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      type: 'PluginApp',
      state,
      raised: false,
      dragging: false,
      pinned: false,
    },
  } as App;
}

describe('PluginAppToolbar (PluginApp.ToolbarComponent)', () => {
  beforeEach(() => {
    mockUpdateState.mockClear();
  });

  it('renders nothing when __toolbar is absent', () => {
    const { container } = render(<ToolbarComponent {...buildApp({ pluginName: 'test' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when __toolbar is not an array', () => {
    const { container } = render(<ToolbarComponent {...buildApp({ pluginName: 'test', __toolbar: 'nope' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one button per valid declared entry', () => {
    render(
      <ToolbarComponent
        {...buildApp({
          pluginName: 'test',
          __toolbar: [
            { id: 'a', label: 'Reconfigure', icon: 'settings', patch: { registered: false } },
            { id: 'b', label: 'Reset', patch: { count: 0 } },
          ],
        })}
      />
    );
    expect(screen.getByText('Reconfigure')).toBeTruthy();
    expect(screen.getByText('Reset')).toBeTruthy();
  });

  it('drops malformed entries so only valid ones render', () => {
    render(
      <ToolbarComponent
        {...buildApp({
          pluginName: 'test',
          __toolbar: [
            { id: 'bad', label: '', patch: {} },
            { id: 'good', label: 'Good Button', patch: { a: 1 } },
          ],
        })}
      />
    );
    expect(screen.getByText('Good Button')).toBeTruthy();
    expect(screen.queryByText('')).toBeNull();
  });

  it('clicking a button calls updateState with the app id and exactly that button patch', () => {
    render(
      <ToolbarComponent
        {...buildApp({
          pluginName: 'test',
          __toolbar: [{ id: 'a', label: 'Reconfigure', patch: { registered: false } }],
        })}
      />
    );
    fireEvent.click(screen.getByText('Reconfigure'));
    expect(mockUpdateState).toHaveBeenCalledTimes(1);
    expect(mockUpdateState).toHaveBeenCalledWith('app-1', { registered: false });
  });

  it('clicking one of several buttons only applies that button patch', () => {
    render(
      <ToolbarComponent
        {...buildApp({
          pluginName: 'test',
          __toolbar: [
            { id: 'a', label: 'First', patch: { view: 'first' } },
            { id: 'b', label: 'Second', patch: { view: 'second' } },
          ],
        })}
      />
    );
    fireEvent.click(screen.getByText('Second'));
    expect(mockUpdateState).toHaveBeenCalledTimes(1);
    expect(mockUpdateState).toHaveBeenCalledWith('app-1', { view: 'second' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webstack && npx nx test applications`
Expected: FAIL — `Cannot find module './PluginAppToolbar' from 'PluginAppToolbar.spec.tsx'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `PluginAppToolbar.tsx`**

Create `webstack/libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.tsx`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */
import { Button, ButtonGroup, Tooltip } from '@chakra-ui/react';
import { MdSettings, MdReplay, MdRefresh, MdEdit, MdDelete } from 'react-icons/md';

import { useAppStore } from '@sage3/frontend';

import { App } from '../../schema';
import { state as AppState } from './index';
import { parseToolbarButtons, ToolbarIconName } from './toolbarTypes';

const TOOLBAR_ICON_ELEMENTS: Record<ToolbarIconName, JSX.Element> = {
  settings: <MdSettings />,
  reset: <MdReplay />,
  refresh: <MdRefresh />,
  edit: <MdEdit />,
  delete: <MdDelete />,
};

/* App toolbar component for the app PluginApp */
export default function ToolbarComponent(props: App): JSX.Element | null {
  const updateState = useAppStore((state) => state.updateState);
  const buttons = parseToolbarButtons((props.data.state as AppState).__toolbar);

  if (buttons.length === 0) return null;

  return (
    <ButtonGroup size="xs" isAttached>
      {buttons.map((btn) => (
        <Tooltip key={btn.id} label={btn.tooltip ?? btn.label} placement="top">
          <Button onClick={() => updateState(props._id, btn.patch)} leftIcon={btn.icon ? TOOLBAR_ICON_ELEMENTS[btn.icon] : undefined}>
            {btn.label}
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd webstack && npx nx test applications`
Expected: PASS — 26 tests total (20 from Task 1 + 6 from this task), 0 failures.

- [ ] **Step 5: Wire `PluginApp.tsx` to use the new component**

In `webstack/libs/applications/src/lib/apps/PluginApp/PluginApp.tsx`, add this import after the existing `import { HiPuzzle } from 'react-icons/hi';` on line 18:

```typescript
import ToolbarComponent from './PluginAppToolbar';
```

Then delete the stub function (lines 82-85):

```typescript
/* App toolbar component for the app PluginApp */
function ToolbarComponent() {
  return null;
}
```

The final `export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };` on line 95 is unchanged — it now refers to the imported `ToolbarComponent` instead of the local stub function of the same name.

- [ ] **Step 6: Type-check the whole `applications` lib**

Run: `cd webstack && npx nx run applications:lint`
Expected: no new errors introduced by `PluginApp.tsx`, `PluginAppToolbar.tsx`, or the two new spec files (pre-existing lint issues elsewhere in the lib, if any, are not this task's concern).

- [ ] **Step 7: Run the full applications test suite once more to confirm nothing broke**

Run: `cd webstack && npx nx test applications`
Expected: PASS — 26 tests total, 0 failures (same count as Step 4 — `PluginApp.tsx`'s own change is a stub removal plus one new import, it has no test file of its own and no test imports it directly, so this step is a regression check on the two spec files that do exist).

- [ ] **Step 8: Commit**

```bash
cd webstack
git add libs/applications/src/lib/apps/PluginApp/PluginApp.tsx \
  libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.tsx \
  libs/applications/src/lib/apps/PluginApp/PluginAppToolbar.spec.tsx
git commit -m "feat(applications): render declared toolbar buttons for PluginApp

New PluginAppToolbar.tsx reads state.__toolbar (validated via
parseToolbarButtons from the previous commit) and renders native
buttons that call the same updateState(id, patch) every other app's
toolbar already uses. Split into its own file rather than left inline
in PluginApp.tsx so it stays independently testable without pulling in
AppWindow's heavier transitive dependency chain. PluginApp.tsx now
imports it instead of defining a stub. GroupedToolbarComponent is
unchanged."
```

---

## Manual Verification (post-implementation, not a subagent task)

After both tasks land, the controller verifies live against the running `sage3-dev` instance (192.168.1.40) rather than dispatching this as a task, since it requires a full webapp build/deploy and a running SAGE3 board — environment the implementer subagents don't have:

1. Build the webapp (`cd webstack && yarn build webapp` or the project's existing prod build command) and deploy to `sage3-dev`.
2. On the already-uploaded "CTFd Dashboard" plugin instance (Team Bravo board), send it a state update including `__toolbar: [{ id: 'reconfigure', label: 'Reconfigure', icon: 'settings', patch: { registered: false } }]` (either by having the plugin's own `App.tsx` emit this on successful registration — a small follow-up change to the CTFd-SAGE plugin repo, tracked separately per the spec's "Out of scope" section — or, for this verification pass, by PATCHing the app's state directly via the API as done earlier in this session).
3. Select the app on the board and confirm the native "Reconfigure" button appears in SAGE3's own toolbar chrome (not inside the plugin's iframe canvas), and that clicking it sets `registered: false` and the plugin's own UI reacts (falls back to its setup view).
