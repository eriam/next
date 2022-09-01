/**
 * Copyright (c) SAGE3 Development Team
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 */

import { isUUIDv4, useAppStore, useAssetStore, useUIStore, useUser } from '@sage3/frontend';
import { App } from '../../schema';

import { state as AppState } from './index';
import { AppWindow } from '../../components';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Asset } from '@sage3/shared/types';
import { Box, Button, ButtonGroup, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Tooltip } from '@chakra-ui/react';
import { MdFastForward, MdFastRewind, MdGraphicEq, MdPause, MdPlayArrow } from 'react-icons/md';

export function getStaticAssetUrl(filename: string): string {
  return `api/assets/static/${filename}`;
}



function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const updateState = useAppStore((state) => state.updateState);
  const update = useAppStore((state) => state.update);

  const { user } = useUser();

  const assets = useAssetStore((state) => state.assets);
  const [url, setUrl] = useState<string>();
  const [file, setFile] = useState<Asset>();
  const [aspectRatio, setAspecRatio] = useState(16 / 9);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const myasset = assets.find((a) => a._id === s.vid);
    if (myasset) {
      setFile(myasset);
      // Update the app title
      update(props._id, { description: 'Video> ' + myasset?.data.originalfilename });
    }
  }, [s.vid, assets]);

  useEffect(() => {
    if (file) {
      // save the url of the video
      setUrl(getStaticAssetUrl(file.data.file));
    }
  }, [file]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.addEventListener('loadedmetadata', (e: Event) => {
        if (e) {
          const w = videoRef.current?.videoWidth ?? 16;
          const h = videoRef.current?.videoHeight ?? 9;
          const ar = w / h;
          setAspecRatio(ar);
        }
      });
    }
  }, [videoRef]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = s.currentTime;
    }
  }, []);
  useEffect(() => {
    if (props._updatedBy === user?._id) {
      updateState(props._id, { currentTime: videoRef.current?.currentTime });
    }
    if (videoRef.current) {
      s.play ? videoRef.current.play() : videoRef.current.pause();
    }
  }, [s.play]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = s.currentTime;
    }
  }, [s.currentTime]);

  const videoContainerStyle: CSSProperties = {
    position: 'relative',
    overflowY: 'hidden',
    height: props.data.size.width / aspectRatio,
     maxHeight: '100%',
  };
  const videoStyle: CSSProperties = { height: '100%', width: '100%' };

  return (
    <AppWindow app={props} lockAspectRatio={aspectRatio}>
      <div style={videoContainerStyle}>
        <video ref={videoRef} id={`${props._id}-video`} src={url} autoPlay={false} height="100%" width="100%"></video>
      </div>
    </AppWindow>
  );
}

function ToolbarComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  const update = useAppStore((state) => state.updateState);
  const [videoRef, setVideoRef] = useState<HTMLVideoElement>(document.getElementById(`${props._id}-video`) as HTMLVideoElement);

  const [duration, setDuration] = useState(10);

  const [sliderTime, setSliderTime] = useState(s.currentTime);

  useEffect(() => {
    let interval: null | NodeJS.Timer = null;
    if (videoRef) {
      setSliderTime(s.currentTime);
      if (s.play) {
        let count = 0;
        interval = setInterval(() => {
          console.log('uhoh')
      
          setSliderTime(sliderTime + count);
          count += 1
        }, 1000);
      } 
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    }
  }, [s.currentTime, s.play])

  useEffect(() => {
    setDuration(videoRef.duration);
  }, [videoRef])


  const handlePlay = () => {
    update(props._id, { play: !s.play });
  };

  const handleRewind = () => {
    update(props._id, { currentTime: Math.max(0, videoRef.currentTime - 5 )});
  };

  const handleForward = () => {
    update(props._id, { currentTime: Math.min(videoRef.duration, videoRef.currentTime + 5 )});

  };
  return (
    <>
      <ButtonGroup isAttached size="xs" colorScheme="teal">
        <Tooltip placement="bottom" hasArrow={true} label={'Rewind 10 Seconds'} openDelay={400}>
          <Button onClick={handleRewind} colorScheme={'green'} _hover={{ opacity: 0.7, transform: 'scaleY(1.3)' }}>
            <MdFastRewind />
          </Button>
        </Tooltip>

        <Tooltip placement="bottom" hasArrow={true} label={s.play ? 'Pause Video' : 'Play Video'} openDelay={400}>
          <Button onClick={handlePlay} colorScheme={'green'} _hover={{ opacity: 0.7, transform: 'scaleY(1.3)' }}>
            {s.play ? <MdPause /> : <MdPlayArrow />}
          </Button>
        </Tooltip>

        <Tooltip placement="bottom" hasArrow={true} label={'Forward 10 Seconds'} openDelay={400}>
          <Button onClick={handleForward} colorScheme={'green'} _hover={{ opacity: 0.7, transform: 'scaleY(1.3)' }}>
            <MdFastForward />
          </Button>
        </Tooltip>
      </ButtonGroup>

      <Slider aria-label="slider-ex-4" value={sliderTime} max={duration} width="200px" mx={2}>
        <SliderTrack bg="green.100">
          <SliderFilledTrack bg="green.400" />
        </SliderTrack>
        <SliderThumb boxSize={6}>
          <Box color="green.500" as={MdGraphicEq} transition={'all 0.2s'} _hover={{ opacity: 0.7, transform: 'scaleY(1.3)', color: "green.300" }}  />
        </SliderThumb>
      </Slider>
    </>
  );
}

export default { AppComponent, ToolbarComponent };
