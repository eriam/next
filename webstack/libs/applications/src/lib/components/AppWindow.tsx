/**
 * Copyright (c) SAGE3 Development Team
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 */

import { Box, calc, Text, useColorModeValue } from '@chakra-ui/react';
import { AppSchema } from '@sage3/applications/schema';
import { useAppStore } from '@sage3/frontend';

import { useEffect, useState } from 'react';
import { DraggableData, Position, ResizableDelta, Rnd } from 'react-rnd';

import { MdOpenInFull, MdOutlineClose, MdOutlineCloseFullscreen } from 'react-icons/md';
import { sageColorByName } from '@sage3/shared';

type WindowProps = {
  app: AppSchema;
  children: JSX.Element;
};

export function AppWindow(props: WindowProps) {
  // Height of the title bar
  const titleBarHeight = 24;

  // App Store
  const update = useAppStore((state) => state.update);
  const deleteApp = useAppStore((state) => state.delete);

  // Local state
  const [pos, setPos] = useState({ x: props.app.position.x, y: props.app.position.y });
  const [size, setSize] = useState({ width: props.app.size.width, height: props.app.size.height });
  const [minimized, setMinimized] = useState(false);

  // If size or position change update the local state.
  useEffect(() => {
    setSize({ width: props.app.size.width, height: props.app.size.height });
    setPos({ x: props.app.position.x, y: props.app.position.y });
  }, [props.app.size, props.app.position]);

  // Handle when the app is dragged by the title bar
  function handleDragStop(_e: any, data: DraggableData) {
    setPos({ x: data.x, y: data.y });
    update(props.app.id, {
      position: {
        x: data.x,
        y: data.y,
        z: props.app.position.z,
      },
    });
  }

  // Handle when the app is resized
  function handleResizeStop(e: MouseEvent | TouchEvent, _direction: any, ref: any, _delta: ResizableDelta, position: Position) {
    // Get the width and height of the app after the resize
    const width = parseInt(ref.offsetWidth);
    // Subtract the height of the title bar. The title bar is just for the UI, we don't want to save the additional height to the server.
    const height = parseInt(ref.offsetHeight) - titleBarHeight;

    // Set local state
    setPos({ x: position.x, y: position.y });
    setSize({ width, height });

    // Update the size and position of the app in the server
    update(props.app.id, {
      position: {
        ...props.app.position,
        x: position.x,
        y: position.y,
      },
      size: {
        ...props.app.size,
        width,
        height,
      },
    });
  }

  // Close the app and delete from server
  function handleClose() {
    deleteApp(props.app.id);
  }

  // Minimize the app. Currently only local.
  function handleMinimize() {
    setMinimized(!minimized);
  }

  return (
    // react-rnd Library for drag and resize events.
    <Rnd
      bounds="parent"
      dragHandleClassName={'handle'}
      size={{ width: size.width, height: `${size.height + titleBarHeight}px` }} // Add the height of the titlebar to give the app the full size.
      position={pos}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      style={{
        boxShadow: `${minimized ? '' : '0 4px 16px rgba(0,0,0,0.2)'}`,
        backgroundColor: `${minimized ? 'transparent' : 'gray'}`,
        overflow: 'hidden',
      }}
    >
      {/* Title Bar */}
      <Box
        className="handle" // The CSS name react-rnd latches on to for the drag events
        display="flex"
        flexDirection="row"
        flexWrap="nowrap"
        justifyContent="space-between"
        alignItems="center"
        backgroundColor={minimized ? sageColorByName('orange') : 'teal'}
        px="1"
        cursor={'move'}
        overflow="hidden"
        whiteSpace="nowrap"
        height={titleBarHeight + 'px'} // The height of the title bar
      >
        {/* Left Title Bar Elements */}
        <Box display="flex" alignItems="center" >
          <Text color="white"><b>{props.app.description}</b></Text>
        </Box>
        {/* Right Title bar Elements */}
        <Box display="flex" alignItems="center">
          {/* Minimize Buttons */}
          {minimized ? (
            <MdOpenInFull cursor="pointer" color="white" onClick={handleMinimize} />
          ) : (
            <MdOutlineCloseFullscreen cursor="pointer" color="white" onClick={handleMinimize} />
          )}
          {/* Close Button Name */}
          <MdOutlineClose cursor="pointer" color="white" fontSize="1.25rem" onClick={handleClose} />
        </Box>
      </Box>
      {/* End Title Bar */}

      {/* The Application */}
      <Box display={minimized ? 'none' : 'inherit'}>{props.children}</Box>
    </Rnd>
  );
}
