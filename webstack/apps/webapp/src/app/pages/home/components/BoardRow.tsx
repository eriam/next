/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useColorModeValue, IconButton, Box, Text } from '@chakra-ui/react';
import { useHexColor } from '@sage3/frontend';
import { Board } from '@sage3/shared/types';
import { MdLock, MdStar, MdExitToApp } from 'react-icons/md';

export function BoardRow(props: { board: Board; selected: boolean; onClick: (board: Board) => void }) {
  const borderColorValue = useColorModeValue(props.board.data.color, props.board.data.color);
  const borderColor = useHexColor(borderColorValue);
  const borderColorGray = useColorModeValue('gray.300', 'gray.700');
  const borderColorG = useHexColor(borderColorGray);

  const linearBGColor = useColorModeValue(
    `linear-gradient(178deg, #ffffff, #fbfbfb, #f3f3f3)`,
    `linear-gradient(178deg, #303030, #252525, #262626)`
  );
  return (
    <Box
      p="1"
      px="2"
      display="flex"
      borderRadius="md"
      justifyContent={'space-between'}
      alignItems={'center'}
      onClick={() => props.onClick(props.board)}
      border={`solid 1px ${props.selected ? borderColor : 'none'}`}
      borderRight={`${borderColor} solid 8px`}
      background={linearBGColor}
      _hover={{ cursor: 'pointer' }}
    >
      <Box display="flex" flexDir="column">
        <Text fontSize="lg" fontWeight="bold" textAlign="left">
          {props.board.data.name}
        </Text>
        <Text fontSize="xs" textAlign="left">
          {props.board.data.description}
        </Text>
      </Box>
      <Box display="flex" gap="2px">
        <IconButton
          size="sm"
          variant={'ghost'}
          aria-label="enter-board"
          fontSize="xl"
          colorScheme="teal"
          icon={<Text>{(Math.random() * 25).toFixed()}</Text>}
        ></IconButton>

        <IconButton size="sm" variant={'ghost'} colorScheme="teal" aria-label="enter-board" fontSize="xl" icon={<MdLock />}></IconButton>

        <IconButton size="sm" variant={'ghost'} colorScheme="teal" aria-label="enter-board" fontSize="xl" icon={<MdStar />}></IconButton>
        <IconButton
          size="sm"
          variant={'ghost'}
          colorScheme="teal"
          aria-label="enter-board"
          fontSize="xl"
          icon={<MdExitToApp />}
        ></IconButton>
      </Box>
    </Box>
  );
}
