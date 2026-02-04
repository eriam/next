/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button, ButtonGroup, Tooltip, Box, useColorModeValue, border } from '@chakra-ui/react';
import mermaid, { type MermaidConfig } from "mermaid";

import { useAppStore } from '@sage3/frontend';
import { MdCode } from 'react-icons/md';

import { state as AppState } from "./index";
import { App, AppGroup } from "../../schema";
import { AppWindow } from '../../components';

import './styles.css';

// Custom error component to display Mermaid errors
function CustomErrorComponent({ error, mermaidCode }: { error: string; mermaidCode: string }) {
  return (
    <Box color="red" fontSize={"xl"}>
      <h3>Diagram Error</h3>
      <p>{error}</p>
      <details>
        <summary >View Code</summary>
        <pre>{mermaidCode}</pre>
      </details>
    </Box>
  );
}


/* App component for Mermaid */
function AppComponent(props: App): JSX.Element {
  // Styling
  const theme = useColorModeValue('forest', 'dark');
  const bgColor = useColorModeValue('gray.100', 'gray.800');
  const borderColor = useColorModeValue('gray.800', 'gray.100');
  // Unique ID for the mermaid container
  const id = `mermaid-${props._id}`;
  // Ref for the mermaid container
  const mermaidRef = useRef<HTMLDivElement>(null);
  // Error state
  const [error, setError] = useState<string | null>(null);

  const d1 = `sequenceDiagram
    Alice ->> Bob: Hello Bob, how are you?
    Bob-->>John: How about you John?
    Bob-x Alice: I am good thanks!
    Bob-x John: I am good thanks!

    Note right of John: Bob thinks a long long time, so long that the text ...

    Bob-->Alice: Checking with John...
    Alice->John: Yes... John, how are you?
  `;

  useEffect(() => {
    if (!mermaidRef.current) return;
    async function renderMermaid(diag: string) {
      const mermaidConfig: MermaidConfig = {
        theme: theme,
      };
      mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        ...mermaidConfig,
      });
      try {
        const { svg } = await mermaid.render(id, diag);
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = svg;
          const svgElement = mermaidRef.current.querySelector('svg');
          if (svgElement) {
            svgElement.style.width = '100%';
            svgElement.style.height = '100%';
            svgElement.style.maxWidth = '100%';
            svgElement.style.maxHeight = '100%';
            svgElement.removeAttribute('width');
            svgElement.removeAttribute('height');
          }
        }
        setError(null);
      } catch (err: any) {
        setError(err?.message || 'Unknown error rendering Mermaid diagram');
        if (mermaidRef.current) mermaidRef.current.innerHTML = '';
      }
    }
    renderMermaid(d1);
  }, [id, theme]);

  return (
    <AppWindow app={props} hideBackgroundIcon={MdCode}>
      <Box p={1} border={'none'} overflow="hidden" height="100%" borderRadius={'md'} background={borderColor}>
        {error ? (
          <CustomErrorComponent error={error} mermaidCode={d1} />
        ) : (
          <Box ref={mermaidRef} borderRadius={'md'}
            width="100%"
            height="100%"
            p={0}
            m={0}
            overflow="hidden"
            background={bgColor}
            display="flex"
            alignItems="center"
            justifyContent="center"
          />
        )}
      </Box>
    </AppWindow >
  )
}

/* App toolbar component for the app Mermaid */
function ToolbarComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const updateState = useAppStore((state) => state.updateState);

  return (
    <>
      <ButtonGroup isAttached size="xs" colorScheme="teal" mr="1">
        <Tooltip placement="top-start" hasArrow={true} label={'Action'} openDelay={400}>
          <Button onClick={console.log}>
            Action
          </Button>
        </Tooltip>
      </ButtonGroup>
    </>
  );
}

/**
 * Grouped App toolbar component, this component will display when a group of apps are selected
 * @returns JSX.Element | null
 */
const GroupedToolbarComponent = (props: { apps: AppGroup }) => { return null; };

export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };
