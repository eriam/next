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
