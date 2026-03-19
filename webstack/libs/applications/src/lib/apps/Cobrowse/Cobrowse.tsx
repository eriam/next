/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import {
  ButtonGroup,
  Button,
  DarkMode,
  useColorMode,
  Tooltip,
  CircularProgress,
  Spinner,
  Box,
  Input,
  useColorModeValue,
  Text,
  ListItem,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  UnorderedList,
  useDisclosure,
  Link,
  Image,
} from '@chakra-ui/react';
import { App, AppGroup } from '../../schema';

import { state as AppState } from './index';
import { AppWindow } from '../../components';
// Styling
import { Component, useEffect, useRef, useState } from 'react';
import { useAppStore, useUser, useUIStore } from '@sage3/frontend';
import { FaFirefoxBrowser, FaClipboard } from 'react-icons/fa';
import { MdVolumeOff, MdVolumeUp } from 'react-icons/md'; // MdVolumeUp
import { TbMouse, TbMouseOff } from 'react-icons/tb';
import { PiTabs } from 'react-icons/pi';

import { VncScreen, RFB } from '../../components/VNC/react-vnc';
import { ContainerAPI as VmsAPI, VEO_URL_TMP } from '../../components/VNC/API';
import { AudioVncService } from '../../components/VNC/AudioVncService';
import { VNCAudioWrapper } from '../../components/VNC/VncWrapper';

/* App component for CoBrowser */

function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const selectedId = useUIStore((state) => state.selectedAppId);
  const isSelected = props._id == selectedId;

  return (
    <AppWindow app={props} hideBackgroundColor={'orange'} hideBordercolor={'orange'} hideBackgroundIcon={FaFirefoxBrowser}>
      <VNCAudioWrapper
        container="firefox-audio"
        envs={{}}
        props={props}
        sAudio={s.audio}
        sNonOwnerViewOnly={s.nonOwnerViewOnly}
        sLastImage={s.lastImage}
        sClipboard={s.clipboard}
        sInit={s.init}
        sRefreshSeed={s.refreshSeed}
        isSelected={isSelected}
      />
    </AppWindow>
  );
}

/* App toolbar component for the app CoBrowser */
function ToolbarComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const updateState = useAppStore((state) => state.updateState);
  const { user } = useUser();

  return (
    <>
      {/* {vmId} */}
      {props._createdBy === user?._id && (
        <>
          {/* <ButtonGroup isAttached size="xs" colorScheme="teal" mr="1"> */}
          <Tooltip
            label={s.nonOwnerViewOnly ? 'Controls are not being shared' : 'Controls are being shared'}
            openDelay={400}
            hasArrow
            placement="top"
          >
            <Button
              size="xs"
              colorScheme={s.nonOwnerViewOnly ? 'red' : 'green'}
              onClick={() => {
                updateState(props._id, { nonOwnerViewOnly: !s.nonOwnerViewOnly });
              }}
            >
              {s.nonOwnerViewOnly ? <TbMouseOff /> : <TbMouse />}
            </Button>
          </Tooltip>
          {/* </ButtonGroup> */}
        </>
      )}
      {/* <Popover trigger="hover">
        {() => (
          <>
            <PopoverTrigger>
              <Button size="xs" colorScheme="teal" ml="1" mr="0" p={0}>
                <PiTabs />
              </Button>
            </PopoverTrigger>
            <PopoverContent fontSize={'sm'} width={'375px'}>
              <PopoverArrow />
              <PopoverCloseButton />
              <PopoverHeader>Urls</PopoverHeader>
              <PopoverBody userSelect={'text'}>
                <UnorderedList>
                  {s.urls.map((url) => (
                    <ListItem key={url} wordBreak="break-all">
                      <Link target="_blank" href={url} wordBreak="break-all">
                        {url}
                      </Link>
                    </ListItem>
                  ))}
                </UnorderedList>
              </PopoverBody>
            </PopoverContent>
          </>
        )}
      </Popover> */}
      <Tooltip label="Click to paste" openDelay={400} hasArrow placement="top">
        <Button
          size="xs"
          ml="1"
          colorScheme="teal"
          onClick={async () => {
            try {
              const clipboardData = await navigator.clipboard.readText();
              if (clipboardData) {
                updateState(props._id, { clipboard: clipboardData });
              }
            } catch (error) {
              // console.error('Failed to read clipboard:', error);
            }
          }}
        >
          <FaClipboard />
        </Button>
      </Tooltip>
      <Tooltip label="Toggle Audio" openDelay={400} hasArrow placement="top">
        <Button
          size="xs"
          ml="1"
          colorScheme="teal"
          onClick={() => {
            updateState(props._id, { audio: !s.audio });
          }}
        >
          {s.audio ? <MdVolumeUp /> : <MdVolumeOff />}
        </Button>
      </Tooltip>
    </>
  );
}

/**
 * Grouped App toolbar component, this component will display when a group of apps are selected
 * @returns JSX.Element | null
 */
const GroupedToolbarComponent = (props: { apps: AppGroup }) => {
  return null;
};

export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };
