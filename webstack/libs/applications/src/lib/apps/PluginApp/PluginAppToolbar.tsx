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
  const buttons = parseToolbarButtons((props.data.state as AppState)?.__toolbar);

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
