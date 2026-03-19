import { useColorMode, Spinner, Box, Image } from '@chakra-ui/react';
import { App, AppGroup } from '../../schema';

// Styling
import { useEffect, useRef, useState, memo } from 'react';
import { useAppStore, useUser, useUIStore } from '@sage3/frontend';

import { VncScreen, RFB } from '../../components/VNC/react-vnc';
import { ContainerAPI as VmsAPI, VEO_URL_TMP } from '../../components/VNC/API';
import { AudioVncService } from '../../components/VNC/AudioVncService';

export interface NoVncProps {
  container: string;
  envs: {};
  //   s: any;
  props: App;
  sAudio: boolean;
  sNonOwnerViewOnly: boolean;
  sLastImage: string;
  sClipboard: string;
  sInit: boolean;
  sRefreshSeed: number;
  isSelected: boolean;
}

const VNCAudioWrapperComponent = ({
  container,
  envs,
  //   s,
  props,
  sAudio,
  sNonOwnerViewOnly,
  sLastImage,
  sClipboard,
  sInit,
  sRefreshSeed,
  isSelected,
}: NoVncProps): JSX.Element => {
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
  }, [isSelected, connected, sNonOwnerViewOnly]);

  useEffect(() => {
    if (isSelected && vmId && !vncScreenRef.current) {
      setRejoinSpinner(true);
      VmsAPI.init(vmId, container, envs).then((jsonData) => {
        if ('url' in jsonData) {
          setWsUrl(jsonData['url']);
          setRejoinSpinner(false);
          updateState(props._id, {
            refreshSeed: Math.random(),
            lastImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
          });
        }
      });
    }
  }, [isSelected]);

  // Get Websocket URL if vmId exists
  useEffect(() => {
    if (sInit) {
      // Send request to start container or recieve websocket if running
      if ((startVmOnLoad && appIsMountingRef.current) || !appIsMountingRef.current) {
        VmsAPI.init(vmId, container, envs).then((jsonData) => {
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
  }, [sRefreshSeed]);

  // Setting View Only Hook
  useEffect(() => {
    if (props._createdBy === user?._id) {
      setViewOnly(false);
    } else {
      setViewOnly(sNonOwnerViewOnly);
    }
  }, [sNonOwnerViewOnly]);

  // Owner Only
  // First instantiation; auto allocated if check if browser is not instanced
  useEffect(() => {
    appIsMountingRef.current = false;
    if (!sInit && props._createdBy === user?._id) {
      VmsAPI.init(vmId, 'firefox-audio', { FIREFOX_THEME: theme }).then((jsonData) => {
        updateState(props._id, {
          refreshSeed: Math.random(),
          init: true,
          lastImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        });
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
    if (sClipboard) {
      vncScreenRef.current?.clipboardPaste(sClipboard);
    }
  }, [sClipboard]);

  return (
    <>
      {!wsUrl &&
        (sLastImage ? (
          <Box position="relative" width="100%" height="100%">
            {rejoinSpinner ? (
              <>
                <Image style={{ filter: 'blur(4px)', width: '100%', height: '100%' }} src={sLastImage} alt="Displayed Image" />

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
              <>
                <Image src={sLastImage} style={{ width: '100%', height: '100%' }} alt="Displayed Image" />
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
                  Click to start {container}
                </Box>
              </>
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
          {audioAutoPlay && sAudio && (
            <AudioVncService
              // To fix desync, we just reload it on select
              key={`audio-${props._id}-${isSelected ? 'selected' : 'deselected'}`}
              wsUrl={`${VEO_URL_TMP}${wsUrl}/audio`}
              enabled={true}
            />
          )}
        </div>
      )}
    </>
  );
};

// Memoize the component to prevent unnecessary re-renders
export const VNCAudioWrapper = memo(VNCAudioWrapperComponent, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render), false if different (re-render)
  return (
    prevProps.container === nextProps.container &&
    prevProps.sAudio === nextProps.sAudio &&
    prevProps.sNonOwnerViewOnly === nextProps.sNonOwnerViewOnly &&
    prevProps.sLastImage === nextProps.sLastImage &&
    prevProps.sClipboard === nextProps.sClipboard &&
    prevProps.sInit === nextProps.sInit &&
    prevProps.sRefreshSeed === nextProps.sRefreshSeed &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.props._id === nextProps.props._id &&
    prevProps.props._createdBy === nextProps.props._createdBy &&
    prevProps.props.data.size.width === nextProps.props.data.size.width &&
    prevProps.props.data.size.height === nextProps.props.data.size.height &&
    JSON.stringify(prevProps.envs) === JSON.stringify(nextProps.envs)
  );
});
