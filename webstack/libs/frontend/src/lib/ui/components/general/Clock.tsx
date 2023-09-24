/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */
import { CSSProperties, useEffect, useState } from 'react';
import { Box, Text, useColorModeValue } from '@chakra-ui/react';

type ClockProps = {
  style?: CSSProperties;
  opacity?: number;
  isBoard?: boolean;
};

// A digital Clock
export function Clock(props: ClockProps) {
  const isBoard = props.isBoard ? props.isBoard : false;

  // State of the current time
  const [time, setTime] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  // Colors
  const textColor = useColorModeValue('gray.800', 'gray.50');
  const backgroundColor = useColorModeValue('#ffffff69', '#22222269');

  // Update the time on an interval every 30secs
  useEffect(() => {
    const interval = window.setInterval(() => {
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (isBoard) {
    return (
      <Box
        borderRadius="md"
        backgroundColor={backgroundColor}
        whiteSpace={'nowrap'}
        width="100%"
        display="flex"
        px={2}
        justifyContent="left"
        alignItems={'center'}>
        <Text fontSize={'lg'} opacity={props.opacity ? props.opacity : 1.0} color={textColor} userSelect="none" whiteSpace="nowrap">
          {time}
        </Text>
      </Box>
    );
  } else {
    return (
      <Box display="flex" style={props.style} alignItems="center" justifyContent="center">
        <Text fontSize={'xl'} opacity={props.opacity ? props.opacity : 1.0} color={textColor} userSelect="none" whiteSpace="nowrap">
          {time}
        </Text>
      </Box>
    );
  }
}
