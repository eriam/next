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
    expect(result.map((b: any) => b.id)).toEqual(input.slice(0, MAX_TOOLBAR_BUTTONS).map((b: any) => b.id));
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
