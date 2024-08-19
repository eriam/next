import React from 'react';
import { Box, ButtonGroup, IconButton, InputGroup, InputLeftElement, Input, Icon } from '@chakra-ui/react';
import { MdList, MdGridView, MdSearch } from 'react-icons/md';
import { IconType } from 'react-icons';
import { BoardCard } from '../BoardCard';
import { Board, Presence } from '@sage3/shared/types';

interface QuickAccessProps {
  title: string;
  icon: IconType;
  boardListView: 'list' | 'grid';
  setBoardListView: (view: 'list' | 'grid') => void;
  boardSearch: string;
  setBoardSearch: (search: string) => void;
  filteredBoards: Board[];
  handleBoardClick: (board: Board) => void;
  selectedBoard: Board | undefined;
  presences: Presence[];
  scrollToBoardRef: React.RefObject<HTMLDivElement>;
}

const QuickAccessPage = ({
  title,
  icon,
  boardListView,
  setBoardListView,
  boardSearch,
  setBoardSearch,
  filteredBoards,
  handleBoardClick,
  selectedBoard,
  presences,
  scrollToBoardRef,
}: QuickAccessProps) => {
  return (
    <Box height="full" display="flex" flexDir="column" justifyContent="space-between">
      <Box display="flex" flexDir="column" p="2">
        <Box fontSize="xx-large" fontWeight="bold" display="flex" alignItems="center" gap="2">
          <Icon as={icon} /> {title}
        </Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mt="4">
          <ButtonGroup size="md" isAttached variant="outline">
            <IconButton
              aria-label="Board List View"
              colorScheme={boardListView === 'list' ? 'teal' : 'gray'}
              onClick={() => setBoardListView('list')}
              icon={<MdList />}
            />
            <IconButton
              aria-label="Board Grid View"
              colorScheme={boardListView === 'grid' ? 'teal' : 'gray'}
              onClick={() => setBoardListView('grid')}
              icon={<MdGridView />}
            />
          </ButtonGroup>

          <InputGroup size="md" width="415px" my="1">
            <InputLeftElement pointerEvents="none">
              <MdSearch />
            </InputLeftElement>
            <Input
              placeholder="Search Boards"
              value={boardSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBoardSearch(e.target.value)}
            />
          </InputGroup>
        </Box>
      </Box>
      <Box h="80%" overflow="auto">
        <Box display="flex" flexWrap="wrap" p="2" gap="2">
          {filteredBoards &&
            filteredBoards.map((board) => (
              <Box key={board._id} ref={board._id === selectedBoard?._id ? scrollToBoardRef : undefined} h="fit-content">
                <BoardCard
                  board={board}
                  onClick={() => handleBoardClick(board)}
                  selected={selectedBoard ? selectedBoard._id === board._id : false}
                  usersPresent={presences.filter((p) => p.data.boardId === board._id)}
                />
              </Box>
            ))}
        </Box>
      </Box>
    </Box>
  );
};

export default QuickAccessPage;
