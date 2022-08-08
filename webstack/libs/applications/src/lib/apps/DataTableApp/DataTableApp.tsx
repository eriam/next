/**
 * Copyright (c) SAGE3 Development Team
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 */

import {
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Box,
  VStack,
  Button,
  Center,
  Input,
  InputGroup,
  InputRightElement,
  Table,
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  HStack,
  Menu, MenuButton, IconButton, MenuList, MenuItem, Portal,
  Spinner,
} from '@chakra-ui/react'

import {GoKebabVertical} from "react-icons/go";
import {FiArrowLeft, FiArrowRight, FiChevronDown} from "react-icons/fi";


import {useAppStore} from '@sage3/frontend';
import {App} from "../../schema";

import {state as AppState} from "./index";
import {AppWindow} from '../../components';
import './styles.css';

import React, {useState, useMemo, useEffect} from 'react';
// import {ColumnMenu} from "./components/ColumnMenu";
import {colMenus} from "./colMenus";


// const Pagination = () => {
//   const pageNumbers = [];
//
//   for (let i = 1; i <= Math.ceil(totalPosts / postsPerPage); i++) {
//     pageNumbers.push(i);
//   }
//
//   function paginater(number: number) {
//     console.log("paginate " + number)
//     // updateState(props._id, {currentPage: number})
//     // updateState(props._id, {currentPosts: s.currentPosts})
//     setCurrentPage(number)
//     setCurrentPosts(currentPosts)
//     updateState(props._id, {messages: "Currently on page " + number})
//     console.log("current page " + currentPage)
//   }
//
//   function handleLeftArrow() {
//     console.log("left arrow")
//     if (currentPage !== 1) {
//       // updateState(props._id, {currentPage: s.currentPage - 1})
//       // updateState(props._id, {currentPosts: s.currentPosts})
//       setCurrentPage(currentPage - 1)
//       setCurrentPosts(currentPosts)
//       setLeftButtonStatus(false)
//       updateState(props._id, {messages: "Currently on page " + (currentPage - 1)})
//       console.log("current page " + (currentPage - 1))
//     } else {
//       console.log("No page before 0")
//       setLeftButtonStatus(true)
//     }
//   }
//
//   function handleRightArrow() {
//     console.log("right arrow")
//     if (currentPage !== pageNumbers.length) {
//       // updateState(props._id, {currentPage: s.currentPage + 1})
//       // updateState(props._id, {currentPosts: s.currentPosts})
//       setCurrentPage(currentPage + 1)
//       setCurrentPosts(currentPosts)
//       setRightButtonStatus(false)
//       updateState(props._id, {messages: "Currently on page " + (currentPage + 1)})
//       console.log("current page " + (currentPage + 1))
//     } else {
//       console.log("No page after " + pageNumbers.length)
//       setRightButtonStatus(true)
//     }
//   }
//
//   //TODO Add focus to current page number
//   return (
//     <div>
//       <HStack spacing='5' display='flex' justify='center' zIndex='dropdown'>
//         <IconButton
//           aria-label='Page left'
//           icon={<FiArrowLeft/>}
//           onClick={() => handleLeftArrow()}
//           disabled={leftButtonStatus}
//         />
//         {pageNumbers.map((number: number) => (
//           <Button
//             key={number}
//             onClick={(e) => paginater(number)}
//           >
//             {number}
//           </Button>
//         ))}
//         <IconButton
//           aria-label='Page right'
//           icon={<FiArrowRight/>}
//           onClick={() => handleRightArrow()}
//           disabled={rightButtonStatus}
//         />
//       </HStack>
//     </div>
//   );
// };

function AppComponent(props: App): JSX.Element {

  const s = props.data.state as AppState;

  const updateState = useAppStore(state => state.updateState);

  // Client local states
  const [data, setData] = useState([])
  const [headers, setHeaders] = useState([])
  const [running, setRunning] = useState((s.executeInfo.executeFunc === "") ? false : true)

  const [leftButtonDisable, setLeftButtonDisable] = useState(true)
  const [rightButtonDisable, setRightButtonDisable] = useState(true)

  // Array of function references to map through for table actions menu
  const tableActions = [transposeTable, tableSort, dropColumns, restoreTable]
  const tableMenuNames = ["Transpose Table", "Sort on Selected Columns", "Drop Selected Columns", "Restore Original Table"]

  // Array of function references to map through for column actions menu
  const columnActions = [tableSort, dropColumns]
  const columnMenuNames = ["Sort on Selected Columns", "Drop Selected Columns"]

  function handleLoadData() {
    console.log("in handleLoadData and updating the executeInfo")
    setRunning(true)
    updateState(props._id,
      {executeInfo: {"executeFunc": "load_data", "params": {}}})
    console.log("new value of executeInfo is ")
    console.log(s.executeInfo)
    console.log("----")
    console.log(s)
  }

  useEffect(() => {
    (s.executeInfo.executeFunc === "") ? setRunning(false) : setRunning(true)
  }, [s.executeInfo.executeFunc])

  //TODO Is there a reason to set items? Does it cost memory or performance?
  //TODO Why are all the useEffects running multiple times upon loading?
  useEffect(() => {
    if (s.viewData != undefined && s.viewData.data != undefined) {
      setData(s.viewData.data)
      setHeaders(s.viewData.columns)

      console.log("loading useEffect")
      console.log("data: " + data)
    }
  }, [s.timestamp])

  // useEffect(() => {
  //   if (items.length !== undefined) {
  //     // Get current posts
  //     const indexOfLastPost = currentPage * postsPerPage;
  //     const indexOfFirstPost = indexOfLastPost - postsPerPage;
  //     setCurrentPosts(items.slice(indexOfFirstPost, indexOfLastPost))
  //     setTotalPosts(items.length)
  //     // updateState(props._id, {currentPosts: s.items.slice(indexOfFirstPost, indexOfLastPost)})
  //     // updateState(props._id, {totalPosts: s.items.length})
  //     console.log("second useEffect")
  //     console.log("total posts: " + totalPosts)
  //   }
  // }, [items, currentPage, postsPerPage])

  useEffect(() => {
    s.selectedCols.forEach((col: any) => {
      const cols = document.querySelectorAll("td[data-col=" + col + "]")
      cols.forEach((cell: any) => {
          cell.className = "highlight"
        }
      )
    })
    console.log("selectedCols useEffect")
  }, [JSON.stringify(s.selectedCols)])

  //TODO Warning: A component is changing an uncontrolled input to be controlled.
  // This is likely caused by the value changing from undefined to a defined value,
  // which should not happen. Decide between using a controlled or uncontrolled input element for the lifetime of the component
  function handleUrlChange(ev: any) {
    updateState(props._id, { dataUrl: ev.target.value})
  }

  //TODO Fix delay in updatestate upon click
  function handleCellClick() {
    console.log('initial click')
    const cells = document.querySelectorAll('td');
    console.log('after cell declaration')
    cells.forEach(cell => {
      cell.addEventListener('click', () => {
        updateState(props._id, {messages: "(Row: " + cell?.closest('tr')?.rowIndex + ", Column: " + cell.cellIndex + ")"})
      })
    })
    console.log('after click')
  }

  function handleColClick(info: string) {
    const cols = document.querySelectorAll("td[data-col=" + info + "]")
    cols.forEach((cell: any) => {
        if (!s.selectedCols?.includes(info)) {
          const checked = s.selectedCols.concat(info)
          updateState(props._id, {selectedCols: checked})
          updateState(props._id, {messages: (info).charAt(0).toUpperCase() + (info).slice(1) + ' tag selected'});
          cell.className = "highlight"
        } else {
          const unchecked = (() => (s.selectedCols?.filter((item: string) => item != info)))()
          updateState(props._id, {selectedCols: unchecked})
          updateState(props._id, {messages: (info).charAt(0).toUpperCase() + (info).slice(1) + ' tag unselected'});
          cell.className = "originalChakra"
        }
      }
    )
  }

  function transposeTable() {
    console.log("Transposing")
    updateState(props._id,
      {executeInfo: {"executeFunc": "transpose_table", "params": {}}})
    console.log(s.executeInfo)
    console.log("----")
    console.log(s)
  }

  function tableSort() {
    console.log("Sorting on " + s.selectedCols)
    updateState(props._id,
      {executeInfo: {"executeFunc": "table_sort", "params": {"selected_cols": s.selectedCols}}})
    console.log(s.executeInfo)
    console.log("----")
    console.log(s)
  }

  function columnSort() {
    console.log("Sorting on " + s.selectedCols)
    updateState(props._id,
      {executeInfo: {"executeFunc": "column_sort", "params": {"selected_cols": s.selectedCols}}})
    console.log(s.executeInfo)
    console.log("----")
    console.log(s)
  }

  function dropColumns() {
    console.log("Dropping columns: " + s.selectedCols)
    updateState(props._id,
      {executeInfo: {"executeFunc": "drop_columns", "params": {"selected_cols": s.selectedCols}}})
    console.log(s.executeInfo)
    console.log("----")
    console.log(s)

    const cols = document.querySelectorAll("td")
    cols.forEach((cell: any) => {
        cell.className = "originalChakra"
      }
    )
  }

  function restoreTable() {
    console.log("Restoring table")
    updateState(props._id,
      {executeInfo: {"executeFunc": "restore_table", "params": {}}})
    console.log(s.executeInfo)
    console.log("----")
    console.log(s)
  }

  //TODO Add Columns
  function addCols() {
    console.log("add column")
  }

  // useEffect(() => {
  //   if (s.currentPage !== 1) {
  //     setLeftButtonStatus(false)
  //   } else {
  //     setLeftButtonStatus(true)
  //   }
  //   if (s.currentPage !== s.totalPages && s.totalRows !== 0) {
  //     setRightButtonStatus(false)
  //   } else {
  //     setRightButtonStatus(true)
  //   }
  //   console.log("pagination useEffect")
  // }, [s.totalRows])


  return (
    <AppWindow app={props}>

      <>
        <div className="Message-Container" style={{display: headers.length !== 0 ? "block" : "none"}}>
          <Menu>
            <MenuButton
              as={IconButton}
              aria-label='Table Operations'
              icon={<GoKebabVertical/>}
              position='absolute'
              top='35px'
              right='15px'
              size="md"
            />
            {/*TODO figure out why chakra sends table menu to another dimension*/}
            <Portal>
              <MenuList>
                {tableActions.map((action, key) => {
                  return (
                    <MenuItem>
                      <MenuButton
                        as={Button}
                        aria-label='Actions'
                        size='xs'
                        variant='link'
                        onClick={action}
                      >
                        {tableMenuNames[key]}
                      </MenuButton>
                    </MenuItem>
                  )
                })
                }
              </MenuList>
            </Portal>
          </Menu>
        </div>

        <div className='URL-Container'>
          <InputGroup size='md'>
            <Input
              type="text"
              value={s.dataUrl}
              onChange={handleUrlChange}
              placeholder={'URL here'}
              // colorScheme='black'
            />
            <InputRightElement width='5rem'>
              <Button variant='outline' onClick={handleLoadData} disabled={running}>Load Data</Button>
            </InputRightElement>
          </InputGroup>
        </div>


        <Center>
          <Spinner
            style={{display: (s.executeInfo.executeFunc === "") ? "none" : "flex"}}
            justify-content='center'
            thickness='4px'
            speed='3s'
            emptyColor='gray.200'
            color='blue.500'
            size='xl'
          />
        </Center>

        <div>
          <p>s.selectedCols: {s.selectedCols}</p>
          <p>totalRows: {s.totalRows}</p>
          <p>currentPage: {s.currentPage}</p>
          <p>headers: {headers}</p>
        </div>

        <div style={{display: s.totalRows !== 0 ? "block" : "none"}}>
          <TableContainer overflowY="auto" display="flex" maxHeight="250px">
            <Table colorScheme="facebook" variant='simple' size="sm" className="originalChakra">
              <Thead>
                <Tr>
                  {
                    headers?.map((header: any, index: number) => (
                      <Th
                        key={index}
                        onClick={(e) => handleColClick(header)}
                      >
                        {header}
                        {/* TODO Make column menus disappear*/}
                        <Menu>
                          {({isOpen}) => (
                            <>
                              <MenuButton
                                as={IconButton}
                                aria-label='Options'
                                size='sm'
                                variant='ghost'
                                icon={<FiChevronDown/>}
                                ml='20%'
                                isActive={isOpen}
                              />
                              <MenuList>
                                {columnActions.map((action, key) => {
                                  return (
                                    <MenuItem>
                                      <MenuButton
                                        as={Button}
                                        aria-label='Actions'
                                        size='xs'
                                        variant='link'
                                        onClick={action}
                                      >
                                        {columnMenuNames[key]}
                                      </MenuButton>
                                    </MenuItem>
                                  )
                                })
                                }
                              </MenuList>
                            </>
                          )}
                        </Menu>
                      </Th>
                    ))
                  }
                </Tr>
              </Thead>

              <Tbody>
                {
                  data?.map((row: any, rowIndex: number) => (
                    <Tr key={rowIndex}>
                      {row.map((cell: any, colIndex: number) => (
                        <Td key={colIndex}
                            data-col={headers[colIndex % headers.length]}
                            onClick={(e) => handleCellClick()}
                        >
                          {cell}
                        </Td>
                      ))}
                    </Tr>
                  ))
                }
              </Tbody>
            </Table>
          </TableContainer>

        </div>

        {/*<div className="Pagination-Container"*/}
        {/*     style={{display: s.totalRows !== 0 ? "block" : "none"}}>*/}
        {/*  <Pagination/>*/}
        {/*</div>*/}

        <div className="Message-Container">
          <VStack spacing={3}>
            <Box
              fontWeight='bold'
            >
              Message Center
            </Box>
            <Alert status='info' variant='top-accent' colorScheme='telegram'>
              <AlertIcon/>
              <AlertTitle>Feedback: </AlertTitle>
              <AlertDescription>{s.messages}</AlertDescription>
              <AlertDescription></AlertDescription>
            </Alert>
          </VStack>
        </div>
      </>

    </AppWindow>
  )
}

function ToolbarComponent(props: App): JSX.Element {

  const s = props.data.state as AppState;

  return (
    <>
    </>
  )
}

export default {AppComponent, ToolbarComponent};
