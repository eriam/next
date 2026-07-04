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
    // Not `screen.queryByText('')`: RTL's default getNodeText() only reads a
    // node's *direct* text-node children, so every wrapper element with no
    // direct text (the render() container div, ButtonGroup's div, etc.) also
    // "matches" the empty string — queryByText('') always throws a multiple-
    // elements error here regardless of whether the bad entry rendered.
    // Asserting the button count directly verifies the malformed entry was
    // dropped without relying on that quirk.
    expect(screen.getAllByRole('button')).toHaveLength(1);
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
