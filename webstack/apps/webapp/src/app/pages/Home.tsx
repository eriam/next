/**
 * Copyright (c) SAGE3 Development Team
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 */

import { useEffect, useState } from 'react';
import { MdSettings } from 'react-icons/md';
import { Box, useColorModeValue, Text, Icon, Divider } from '@chakra-ui/react';

import { SBDocument } from '@sage3/sagebase';
import { usePresence, usePresenceStore, useUsersStore } from '@sage3/frontend';
import { BoardSchema, RoomSchema } from '@sage3/shared/types';

import { BoardList } from '../components/Home/BoardList';
import { HomeAvatar } from '../components/Home/HomeAvatar';
import { RoomList } from '../components/Home/RoomList';

export function HomePage() {
  const [selectedRoom, setSelectedRoom] = useState<SBDocument<RoomSchema> | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<SBDocument<BoardSchema> | null>(null);

  const imageUrl = useColorModeValue('/assets/SAGE3LightMode.png', '/assets/SAGE3DarkMode.png');

  const subscribeToPresence = usePresenceStore((state) => state.subscribe);
  const subscribeToUsers = useUsersStore((state) => state.subscribeToUsers);
  const { update: updatePresence } = usePresence();

  // Subscribe to user updates
  useEffect(() => {
    subscribeToPresence();
    subscribeToUsers();
  }, []);

  function handleRoomClick(room: SBDocument<RoomSchema>) {
    setSelectedRoom(room);
    updatePresence({ roomId: room._id, boardId: '' });
    setSelectedBoard(null);
  }

  function handleBoardClick(board: SBDocument<BoardSchema>) {
    setSelectedBoard(board);
  }

  const borderColor = useColorModeValue('gray.300', 'white');

  return (
    <Box p="2">
      <Box display="flex" flexDirection="row" flexWrap="nowrap">
        {/* List of Rooms Sidebar */}
        <Box display="flex" flexGrow="0" flexDirection="column" flexWrap="nowrap" height="100vh" px="3">
          <RoomList selectedRoom={selectedRoom} onRoomClick={handleRoomClick}></RoomList>
        </Box>

        {/* Selected Room */}
        <Box flexGrow="8" mx="5">
          <Box display="flex" flexDirection="row">
            <Box display="flex" flexWrap="wrap" flexDirection="column" width={[300, 300, 400, 700]}>
              {selectedRoom ? (
                <>
                  <Box display="flex" justifyContent="center">
                    <Text fontSize={'4xl'}>{selectedRoom?.data.name}</Text>
                  </Box>

                  <Box display="flex" justifyContent="center" width="100%" height="80px" borderRadius="md" py={2}>
                    <Box
                      width="100%"
                      height="100%"
                      backgroundColor="purple.500"
                      borderRadius="md"
                      display="flex"
                      justifyContent="center"
                      alignItems={'center'}
                      mr="2"
                      fontWeight={'bold'}
                      transition={'all 0.2s ease-in-out'}
                      _hover={{ transform: 'scale(1.05)' }}
                      cursor="pointer"
                      border="2px solid white"
                      fontSize="lg"
                      borderColor={borderColor}
                      color="white"
                    >
                      {'Edit'}
                    </Box>
                    <Box
                      width="100%"
                      height="100%"
                      backgroundColor="yellow.500"
                      borderRadius="md"
                      display="flex"
                      justifyContent="center"
                      alignItems={'center'}
                      mx="2"
                      fontWeight={'bold'}
                      transition={'all 0.2s ease-in-out'}
                      _hover={{ transform: 'scale(1.05)' }}
                      cursor="pointer"
                      fontSize="lg"
                      border="2px solid white"
                      borderColor={borderColor}
                      color="white"
                    >
                      {'Info'}
                    </Box>
                    <Box
                      width="100%"
                      height="100%"
                      backgroundColor="blue.500"
                      borderRadius="md"
                      display="flex"
                      justifyContent="center"
                      alignItems={'center'}
                      ml="2"
                      fontWeight={'bold'}
                      transition={'all 0.2s ease-in-out'}
                      _hover={{ transform: 'scale(1.1)' }}
                      cursor="pointer"
                      border="2px solid white"
                      fontSize="lg"
                      borderColor={borderColor}
                      color="white"
                    >
                      {'Users'}
                    </Box>
                  </Box>

                  <BoardList onBoardClick={handleBoardClick} selectedRoom={selectedRoom}></BoardList>
                </>
              ) : null}
            </Box>

            <Box width="100%" height="100%" borderRadius="md" ml={8} display="flex" flexDirection="column">
              {selectedBoard ? (
                <>
                  <Box display="flex" justifyContent="center">
                    <Text fontSize={'4xl'}>{selectedBoard?.data.name}</Text>
                  </Box>
                  <Box
                    display="flex"
                    justifyContent="center"
                    width="100%"
                    height="300px"
                    backgroundColor="gray.600"
                    borderRadius="md"
                    p="2"
                  ></Box>
                </>
              ) : null}
            </Box>
          </Box>
        </Box>
      </Box>

      <Box position="absolute" left="2" bottom="4" display="flex" alignItems="center">
        <HomeAvatar />
      </Box>

      {/* The Corner SAGE3 Image */}
      <Box position="absolute" bottom="2" right="2" opacity={0.7}>
        <img src={imageUrl} width="75px" alt="" />
      </Box>
    </Box>
  );
}
