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

export interface NoVncProps {
  container: string;
  envs: {};
  s: any;
  props: App;
}

export const VNCAudioWrapper = ({ container, envs, s, props }: NoVncProps): JSX.Element => {
  const { colorMode } = useColorMode();
  const theme = colorMode === 'light' ? 1 : 0;

  const [wsUrl, setWsUrl] = useState<string | undefined>(undefined);
  const [viewOnly, setViewOnly] = useState<boolean>(true);
  const [connected, setVncConnected] = useState<boolean>(false);
  const [rejoinSpinner, setRejoinSpinner] = useState<boolean>(false);
  const [audioAutoPlay, setAudioAutoPlay] = useState<boolean>(false);

  const { user } = useUser();
  const updateState = useAppStore((state) => state.updateState);
  const vncScreenRef = useRef<React.ElementRef<typeof VncScreen>>(null);
  const audioRef = useRef(null);

  const selectedId = useUIStore((state) => state.selectedAppId);
  const isSelected = props._id == selectedId;

  // If you want to start when user joins room or when user selects app
  const startVmOnLoad = false;
  const appIsMountingRef = useRef(true);
  const vmId = props._id;

  // Audio Autoplay Service
  useEffect(() => {
    if (audioAutoPlay) return; // Already received gesture, no need to listen

    const handleUserGesture = () => {
      setAudioAutoPlay(true);
    };

    // Listen for various user interaction events
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    events.forEach((event) => {
      window.addEventListener(event, handleUserGesture, { once: true });
    });

    // Cleanup listeners if component unmounts before gesture
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleUserGesture);
      });
    };
  }, [audioAutoPlay]);

  // keyboard grabbing on refresh on vnc load & on app selection
  useEffect(() => {
    if (isSelected) {
      vncScreenRef.current?.focus();
      vncScreenRef.current?.rfb?._keyboard.grab();
    } else {
      vncScreenRef.current?.rfb?._keyboard.ungrab();
      vncScreenRef.current?.blur();
    }
  }, [isSelected, connected, s.nonOwnerViewOnly]);

  useEffect(() => {
    if (isSelected && vmId && !vncScreenRef.current) {
      setRejoinSpinner(true);
      VmsAPI.init(vmId, 'firefox-audio', { FIREFOX_URLS: s.urls, FIREFOX_THEME: theme }).then((jsonData) => {
        if ('url' in jsonData) {
          setWsUrl(jsonData['url']);
          setRejoinSpinner(false);
          updateState(props._id, { refreshSeed: Math.random() });
        }
      });
    }
  }, [isSelected]);

  // Get Websocket URL if vmId exists
  useEffect(() => {
    if (s.init) {
      // Send request to start container or recieve websocket if running
      if ((startVmOnLoad && appIsMountingRef.current) || !appIsMountingRef.current) {
        VmsAPI.init(vmId, 'firefox-audio', { FIREFOX_URLS: s.urls, FIREFOX_THEME: theme }).then((jsonData) => {
          if ('url' in jsonData) {
            setWsUrl(jsonData['url']);
          }
        });
      }
      // Send request to check if container is running or not, do not issue start command on first load
      else if (appIsMountingRef.current) {
        VmsAPI.check(vmId).then((jsonData) => {
          if ('url' in jsonData) {
            setWsUrl(jsonData['url']);
          }
        });
      }
    }
  }, [s.refreshSeed]);

  // Setting View Only Hook
  useEffect(() => {
    if (props._createdBy === user?._id) {
      setViewOnly(false);
    } else {
      setViewOnly(s.nonOwnerViewOnly);
    }
  }, [s.nonOwnerViewOnly]);

  // Owner Only
  // First instantiation; auto allocated if check if browser is not instanced
  useEffect(() => {
    appIsMountingRef.current = false;
    if (!s.init && props._createdBy === user?._id) {
      VmsAPI.init(vmId, 'firefox-audio', { FIREFOX_THEME: theme }).then((jsonData) => {
        updateState(props._id, { refreshSeed: Math.random(), init: true, urls: [''] });
      });
    }
  }, []);

  // Paste Interception
  // Hacky way to get paste to work, but user must be aware the mouse must hover the app
  // It should be feasible to create a fullscreen (absolute, w:100%, h:100%, index: 99) div to capture the mouse
  // const handleMouseEnter = async () => {
  //   try {
  //     const clipboardData = await navigator.clipboard.readText();
  //     if (clipboardData) {
  //       vncScreenRef.current?.clipboardPaste(clipboardData);
  //     }
  //   } catch (error) {
  //     // console.error('Failed to read clipboard:', error);
  //   }gi
  // };
  // Less privacy invasive solution to paste grabbing
  useEffect(() => {
    if (s.clipboard) {
      vncScreenRef.current?.clipboardPaste(s.clipboard);
    }
  }, [s.clipboard]);

  return (
    <AppWindow app={props} hideBackgroundColor={'orange'} hideBordercolor={'orange'} hideBackgroundIcon={FaFirefoxBrowser}>
      <>
        {!wsUrl &&
          (s.lastImage ? (
            <Box position="relative" width="100%" height="100%">
              {rejoinSpinner ? (
                <>
                  <Image style={{ filter: 'blur(4px)', width: '100%', height: '100%' }} src={s.lastImage} alt="Displayed Image" />

                  <Box
                    position="absolute"
                    top="0"
                    left="0"
                    width="100%"
                    height="100%"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Spinner thickness="4px" speed="1.5s" emptyColor="gray.200" color="orange" size="xl" />
                  </Box>
                </>
              ) : (
                <Image src={s.lastImage} style={{ width: '100%', height: '100%' }} alt="Displayed Image" />
              )}
            </Box>
          ) : (
            // vmId ? <div>Select App to Start</div> :
            <Box
              // w="100%"
              h="100%"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              {/* <CircularProgress isIndeterminate color='orange'/> */}
              <Spinner thickness="4px" speed="1.5s" emptyColor="gray.200" color="orange" size="xl" />
            </Box>
          ))}
        {wsUrl && (
          <div
            style={{
              width: '100%',
              height: '100%',
            }}
            // onMouseEnter={handleMouseEnter}
            // onMouseLeave={handleMouseLeave}
          >
            <VncScreen
              url={`${VEO_URL_TMP}${wsUrl}/vnc`}
              viewOnly={viewOnly}
              focusOnClick={false}
              // scaleViewport
              resizeSession
              qualityLevel={2} //8
              compressionLevel={8} //2
              // Dynamically Scaling Quality Level?
              // qualityLevel={Math.min(Math.max(Math.round((1-((props.data.size.width + 400)/5000)) * 9), 0), 9)}
              // compressionLevel={Math.min(Math.max(Math.round(((props.data.size.width + 400)/5000) * 9), 0), 9)}

              autoConnect={true}
              retryDuration={100}
              debug={true}
              background="#000000"
              style={{
                width: '100%',
                height: '100%',
              }}
              ref={vncScreenRef}
              screenSizeWidth={props.data.size.width}
              screenSizeHeight={props.data.size.height}
              // selected={isSelected}
              // loadingUI={(<>LOADING</>)}
              onConnect={(rfb: RFB) => {
                // console.log(rfb);
                setVncConnected(true);
                // updateScreenshot(200);
              }}
              onDisconnect={(rfb: RFB) => {
                // console.log(rfb);
              }}
              onDesktopName={(e: any) => {
                // console.log(e);
              }}
              onCapabilities={(e: any) => {
                // console.log(e);
              }}
              onClipboard={async (e: any) => {
                try {
                  // console.log(e.detail.selected)
                  // if (e.selected) {
                  await navigator.clipboard.writeText(e.detail.text);
                  // console.log('Text copied to clipboard:', e.detail.text);
                  // }
                } catch (error) {
                  // console.error('Failed to copy text to clipboard:', error);
                }
                // console.log(e)
              }}
            />
            {audioAutoPlay && s.audio && (
              <AudioVncService
                wsUrl={`${VEO_URL_TMP}${wsUrl}/audio`}
                enabled={true}
                // onConnectionChange?: (connected: boolean) => void;
              />
            )}
          </div>
        )}
      </>
    </AppWindow>
  );
};
