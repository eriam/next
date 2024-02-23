/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { v5 as uuidv5 } from 'uuid';
// Packing algorithm
import potpack from 'potpack';

import {
  Box,
  useColorModeValue,
  Text,
  Button,
  Tooltip,
  useDisclosure,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuGroup,
  MenuDivider,
  useToast,
} from '@chakra-ui/react';

import { MdDownload, MdSaveAlt, MdCopyAll, MdSend, MdZoomOutMap, MdChat, MdMenu, MdPinDrop, MdAutoAwesomeMosaic, MdAutoAwesomeMotion } from 'react-icons/md';
import { HiOutlineTrash } from 'react-icons/hi';
import { FaPython } from 'react-icons/fa';

import {
  ConfirmModal,
  useAbility,
  useAppStore,
  useBoardStore,
  useHexColor,
  useThrottleApps,
  useUIStore,
  setupApp,
  useCursorBoardPosition,
  useConfigStore,
  apiUrls,
  useAssetStore,
  downloadFile,
} from '@sage3/frontend';
import { Applications } from '@sage3/applications/apps';
import { AppSchema } from '@sage3/applications/schema';
import { Board } from '@sage3/shared/types';
import { initialValues } from '@sage3/applications/initialValues';

type LassoToolbarProps = {
  downloadAssets: () => void;
};

/**
 * Lasso Toolbar Component
 *
 * @export
 * @param {LassoToolbarProps} props
 * @returns
 */
export function LassoToolbar(props: LassoToolbarProps) {
  const { roomId, boardId } = useParams();
  const toast = useToast();

  // App Store
  const apps = useThrottleApps(250);
  const deleteApp = useAppStore((state) => state.delete);
  const duplicate = useAppStore((state) => state.duplicateApps);
  const createApp = useAppStore((state) => state.create);
  const update = useAppStore((state) => state.update);
  const updateBatch = useAppStore((state) => state.updateBatch);

  // UI Store
  const lassoApps = useUIStore((state) => state.selectedAppsIds);
  const fitApps = useUIStore((state) => state.fitApps);
  const [showLasso, setShowLasso] = useState(lassoApps.length > 0);

  // Position
  const { boardCursor } = useCursorBoardPosition();

  // Boards
  const boards = useBoardStore((state) => state.boards);
  const roomsBoards = boards.filter((b) => b.data.roomId === roomId);

  // Theme
  const background = useColorModeValue('gray.50', 'gray.700');
  const panelBackground = useHexColor(background);
  const textColor = useColorModeValue('gray.800', 'gray.100');
  const borderColor = useColorModeValue('gray.200', 'gray.500');

  // Modal disclosure for the Close selected apps
  const { isOpen: deleteIsOpen, onClose: deleteOnClose, onOpen: deleteOnOpen } = useDisclosure();

  // Abiities
  const canDeleteApp = useAbility('delete', 'apps');
  const canCreateApp = useAbility('create', 'apps');
  const canMoveApp = useAbility('move', 'apps');
  const canPin = useAbility('pin', 'apps');
  const canDownload = useAbility('download', 'assets');

  // Submenu for duplicating to another board
  const hoverColorMode = useColorModeValue('gray.100', 'whiteAlpha.100');
  const hoverColor = useHexColor(hoverColorMode);
  const [sendToBoardSubmenuOpen, setSendToBoardSubmenuOpen] = useState<boolean>(false);
  const openSendToBoardSubmenu = () => {
    if (!sendToBoardSubmenuOpen) setSendToBoardSubmenuOpen(true);
  };
  const closeSendToBoardSubmenu = () => {
    if (sendToBoardSubmenuOpen) setSendToBoardSubmenuOpen(false);
  };
  const toggleSendToBoardSubmenu = () => {
    setSendToBoardSubmenuOpen(!sendToBoardSubmenuOpen);
  };

  useEffect(() => {
    setShowLasso(lassoApps.length > 0);
    // selectedAppFunctions();
  }, [lassoApps]);

  // Close all the selected apps
  const closeSelectedApps = () => {
    deleteApp(lassoApps);
    deleteOnClose();
    setShowLasso(false);
  };

  // Zoom the user's view to fit all the selected apps
  const fitSelectedApps = () => {
    const selectedApps = apps.filter((el) => lassoApps.includes(el._id));
    fitApps(selectedApps);
  };

  // Pin/Unpin all the selected apps
  const pin = () => {
    const selectedApps = apps.filter((el) => lassoApps.includes(el._id));
    if (selectedApps.length > 0) {
      // use the first app to determine the state of the rest
      const pinned = selectedApps[0].data.pinned;
      // Array of update to batch at once
      const ps: Array<{ id: string; updates: Partial<AppSchema> }> = [];
      selectedApps.forEach((el) => {
        ps.push({ id: el._id, updates: { pinned: !pinned } });
      });
      // Update all the apps at once
      updateBatch(ps);
    }
  };

  // This function will check if the selected apps are all of the same type
  // Then, it will check if that type has a GroupedToolbarComponent to display
  const selectedAppFunctions = (): JSX.Element | null => {
    const selectedApps = apps.filter((el) => lassoApps.includes(el._id));

    // Check if all of same type
    let isAllOfSameType = selectedApps.every((element) => element.data.type === selectedApps[0].data.type);

    let component = null;

    // If they are all of same type
    if (isAllOfSameType) {
      const firstApp = selectedApps[0];
      // Check if that type has a GroupedToolbarComponent
      if (firstApp && firstApp.data.type in Applications) {
        const Component = Applications[firstApp.data.type].GroupedToolbarComponent;
        if (Component) component = <Component key={firstApp._id} apps={selectedApps}></Component>;
      }
    }
    // Return the component
    return component;
  };

  // Duplicate all the selected apps
  const handleDuplicateApps = () => {
    duplicate(lassoApps);
  };

  // Duplicate all the selected apps to a different board
  const duplicateToBoard = (board: Board) => {
    duplicate(lassoApps, board);
  };

  /**
   * Save the selected apps into a session file
   */
  const saveSelectedSession = () => {
    const boardName = boards.find((b) => b._id === boardId)?.data.name || 'session';
    const filename = boardName + '.s3json';
    const selectedapps = useUIStore.getState().savedSelectedAppsIds;
    // Use selected apps if any or all apps
    const apps = selectedapps.length > 0 ?
      useAppStore.getState().apps.filter((a) => selectedapps.includes(a._id))
      : useAppStore.getState().apps;
    const namespace = useConfigStore.getState().config.namespace;
    const assets = apps.reduce<{ id: string, url: string, filename: string }[]>(function (arr, app) {
      if (app.data.state.assetid) {
        // Generate a public URL of the file
        const token = uuidv5(app.data.state.assetid, namespace);
        const publicURL = apiUrls.assets.getPublicURL(app.data.state.assetid, token);
        const asset = useAssetStore.getState().assets.find((a) => a._id === app.data.state.assetid);
        if (asset) {
          arr.push({ id: app.data.state.assetid, url: window.location.origin + publicURL, filename: asset.data.originalfilename });
        }
      }
      return arr;
    }, []);
    // Data structure to save
    const savedapps = apps.map((app) => {
      // making sure apps have the right state
      return { ...app, data: { ...app.data, state: { ...initialValues[app.data.type], ...app.data.state, } } };
    });
    const session = {
      assets: assets,
      apps: savedapps, // apps,
    }
    const payload = JSON.stringify(session, null, 2);
    const jsonurl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(payload);
    // Trigger the download
    downloadFile(jsonurl, filename);
    // Success message
    toast({
      title: 'Board saved',
      description: apps.length + ' apps saved to ' + filename,
      status: 'info',
      duration: 4000,
      isClosable: true,
    });
  };

  const openInChat = () => {
    const x = boardCursor.x - 200;
    const y = boardCursor.y - 700;
    if (roomId && boardId) {
      // Check if all of same type
      const selectedApps = apps.filter((el) => lassoApps.includes(el._id));
      let isAllOfSameType = selectedApps.every((element) => element.data.type === selectedApps[0].data.type);
      let context = '';
      if (isAllOfSameType) {
        if (selectedApps[0].data.type === 'Stickie') {
          context = selectedApps.reduce((acc, el) => {
            acc += el.data.state.text + '\n';
            return acc;
          }, '');
        }
      }
      createApp(setupApp('Chat', 'Chat', x, y, roomId, boardId, { w: 800, h: 420 }, { context: context }));
    }
  };

  const openInCell = () => {
    const x = boardCursor.x - 200;
    const y = boardCursor.y - 1000;
    if (roomId && boardId) {
      let code = '';
      // Check if all of same type
      const selectedApps = apps.filter((el) => lassoApps.includes(el._id));
      let isAllOfSameType = selectedApps.every((element) => element.data.type === selectedApps[0].data.type);
      if (isAllOfSameType && selectedApps[0].data.type === 'CSVViewer') {
        code = `# Load all the CSV files
import pandas as pd
from foresight.config import config as conf, prod_type
from foresight.Sage3Sugar.pysage3 import PySage3
room_id = %%sage_room_id
board_id = %%sage_board_id
app_id = %%sage_app_id
selected_apps = %%sage_selected_apps
ps3 = PySage3(conf, prod_type)
smartbits = ps3.get_smartbits(room_id, board_id)
cell = smartbits[app_id]
bits = [smartbits[a] for a in selected_apps]
for b in bits:
    url = ps3.get_public_url(b.state.assetid)
    frame = pd.read_csv(url)
    print(frame)`;
      } else {
        code = `# Setup SAGE3 API
from foresight.config import config as conf, prod_type
from foresight.Sage3Sugar.pysage3 import PySage3
room_id = %%sage_room_id
board_id = %%sage_board_id
app_id = %%sage_app_id
selected_apps = %%sage_selected_apps
ps3 = PySage3(conf, prod_type)
smartbits = ps3.get_smartbits(room_id, board_id)
cell = smartbits[app_id]
bits = [smartbits[a] for a in selected_apps]
for b in bits:
    print(b)`;
      }
      createApp(setupApp('SageCell', 'SageCell', x, y, roomId, boardId, { w: 960, h: 860 }, { fontSize: 24, code }));
    }
  };

  // Calculate a new layout for the selected apps
  const autoLayout_pack = () => {
    const selectedApps = apps.filter((el) => lassoApps.includes(el._id));
    const boxes = selectedApps.map((el) => {
      return {
        app: el,
        bbox: [el.data.position.x, el.data.position.y, el.data.position.x + el.data.size.width, el.data.position.y + el.data.size.height],
        area: el.data.size.width * el.data.size.height,
      }
    });
    // sort by size
    boxes.sort((a, b) => b.area - a.area);

    const padding = 30;
    // calculate the center of the bounding boxes
    const minx = Math.min(...boxes.map((el) => el.bbox[0]));
    const maxx = Math.max(...boxes.map((el) => el.bbox[2]));
    const miny = Math.min(...boxes.map((el) => el.bbox[1]));
    const maxy = Math.max(...boxes.map((el) => el.bbox[3]));
    const center = [padding / 2 + (minx + maxx) / 2, padding / 2 + (miny + maxy) / 2];

    const data = boxes.map((el) => ({
      w: el.app.data.size.width + padding, h: el.app.data.size.height + padding,
      id: el.app._id, x: 0, y: 0
    }));

    // Array of update to batch at once
    const ps: Array<{ id: string; updates: Partial<AppSchema> }> = [];
    // Packing algorithm
    const { w, h, fill } = potpack(data);
    // Build batched updates
    data.forEach((el) => {
      const app = apps.find((a) => a._id === el.id);
      const x = center[0] + el.x - w / 2;
      const y = center[1] + el.y - h / 2;
      if (app) {
        ps.push({ id: app._id, updates: { position: { ...app.data.position, x, y } } });
      }
    });
    // Update all the apps at once
    updateBatch(ps);
  };

  // Calculate a new layout using Binary Tree Algorithm for 2D Bin Packing
  // based on: https://github.com/jakesgordon/bin-packing
  const autoLayout_binpacking = () => {
    const padding = 30 / 2; // half in each dimension
    const selectedApps = apps.filter((el) => lassoApps.includes(el._id));
    const boxes = selectedApps.map((el) => {
      const w = el.data.size.width + 2 * padding;
      const h = el.data.size.height + 2 * padding;
      const x = el.data.position.x - padding;
      const y = el.data.position.y - padding;
      return {
        app: el,
        id: el._id,
        w: w,
        h: h,
        x: x,
        y: y,
        bbox: [x, y, x + w, y + h],
        area: w * h,
        fit: { x: 0, y: 0 }
      }
    });
    // Sort by size
    boxes.sort((a, b) => b.area - a.area);

    // Calculate the center of the bounding boxes
    const minx = Math.min(...boxes.map((el) => el.bbox[0]));
    const maxx = Math.max(...boxes.map((el) => el.bbox[2]));
    const miny = Math.min(...boxes.map((el) => el.bbox[1]));
    const maxy = Math.max(...boxes.map((el) => el.bbox[3]));
    const center = [(minx + maxx) / 2, (miny + maxy) / 2];

    // Packer algorithm
    // @ts-ignore
    var packer = new GrowingPacker();
    packer.fit(boxes);
    // Get the size of the packed rectangle
    const pw = packer.root.w;
    const ph = packer.root.h;
    // Array of update to batch at once
    const ps: Array<{ id: string; updates: Partial<AppSchema> }> = [];
    for (var n = 0; n < boxes.length; n++) {
      var block = boxes[n];
      if (block.fit) {
        const app = apps.find((a) => a._id === block.id);
        const x = center[0] + block.fit.x - pw / 2;
        const y = center[1] + block.fit.y - ph / 2;
        if (app) {
          ps.push({ id: app._id, updates: { position: { ...app.data.position, x, y } } });
        }
      }
    }
    // Update all the apps at once
    updateBatch(ps);
  };

  return (
    <>
      {showLasso && (
        <Box
          transform={`translateX(-50%)`}
          position="absolute"
          left="50vw"
          bottom="6px"
          border="solid 3px"
          borderColor={borderColor}
          bg={panelBackground}
          p="2"
          rounded="md"
          zIndex={1410} // above the drawer but with tooltips
        >
          <Box display="flex" flexDirection="column">
            <Text
              w="100%"
              textAlign="left"
              mx={1}
              color={textColor}
              fontSize={12}
              fontWeight="bold"
              h={'auto'}
              userSelect={'none'}
              className="handle"
            >
              {'Actions'}
            </Text>
            <Box alignItems="center" p="0" m="0" width="100%" display="flex" height="32px" userSelect={'none'}>
              {/* Show the GroupedToolberComponent here */}
              {selectedAppFunctions()}

              <Menu>
                <MenuButton size="xs" as={Button} mr={'2px'} colorScheme="yellow">
                  <MdMenu />
                </MenuButton>
                <MenuList p="0" m="0">
                  <MenuGroup title="Actions" m="1">
                    <MenuItem onClick={fitSelectedApps} icon={<MdZoomOutMap />} py="0" m="0">
                      Zoom To Apps
                    </MenuItem>
                    <MenuItem isDisabled={!canPin} onClick={pin} icon={<MdPinDrop />} py="0" m="0">
                      Pin Apps
                    </MenuItem>
                    <MenuItem isDisabled={!canCreateApp} onClick={handleDuplicateApps} icon={<MdCopyAll />} py="0" m="0">
                      Duplicate Apps
                    </MenuItem>
                    {/* Submenu */}
                    <Menu isOpen={sendToBoardSubmenuOpen} placement="right-end" onClose={closeSendToBoardSubmenu}>
                      <MenuButton
                        as={MenuItem} py="0" m="0"
                        isDisabled={!canCreateApp}
                        onClick={toggleSendToBoardSubmenu}
                        icon={<MdSend />}
                        _hover={{ backgroundColor: hoverColor }}
                      >
                        Duplicate to another Board
                      </MenuButton>
                      <MenuList>
                        {roomsBoards.map((b) => {
                          return (
                            <MenuItem key={b._id} onClick={() => duplicate(lassoApps, b)} py="0" m="0">
                              {b.data.name}
                            </MenuItem>
                          );
                        })}
                      </MenuList>
                    </Menu>
                  </MenuGroup>

                  <MenuDivider />

                  <MenuGroup title="Download" m="1">
                    <MenuItem isDisabled={!canDownload} onClick={props.downloadAssets} icon={<MdDownload />} py="0" m="0">
                      Download Selected Assets
                    </MenuItem>
                    <MenuItem isDisabled={!canDownload} onClick={saveSelectedSession} icon={<MdSaveAlt />} py="0" m="0">
                      Save Selected to Session
                    </MenuItem>
                  </MenuGroup>
                  <MenuDivider />

                  <MenuGroup title="Layouts" m="1">
                    <Tooltip placement="top" hasArrow={true} label={'Bin Packing Algorithm'} openDelay={400}>
                      <MenuItem isDisabled={!canMoveApp} onClick={autoLayout_binpacking} icon={<MdAutoAwesomeMosaic />} py="0" m="0">
                        Compact Layout
                      </MenuItem>
                    </Tooltip>
                    <Tooltip placement="top" hasArrow={true} label={'Fits apps into a rectangle'} openDelay={400}>
                      <MenuItem isDisabled={!canMoveApp} onClick={autoLayout_pack} icon={<MdAutoAwesomeMotion />} py="0" m="0">
                        Rectangle Layout
                      </MenuItem>
                    </Tooltip>
                  </MenuGroup>

                  <MenuDivider />

                  <MenuGroup title="AI Actions" m="1">
                    <MenuItem isDisabled={!canCreateApp} onClick={openInCell} icon={<FaPython />} py="0" m="0">
                      Open in SAGECell
                    </MenuItem>
                    <MenuItem isDisabled={!canCreateApp} onClick={openInChat} icon={<MdChat />} py="0" m="0">
                      Open in Chat
                    </MenuItem>
                  </MenuGroup>
                </MenuList>
              </Menu>

              <Tooltip placement="top" hasArrow={true} label={'Open in Chat'} openDelay={400}>
                <Button onClick={openInChat} size="xs" p="0" mx="2px" colorScheme={'yellow'} isDisabled={!canDeleteApp}>
                  <MdChat size="18px" />
                </Button>
              </Tooltip>
              <Tooltip placement="top" hasArrow={true} label={'Open in SageCell'} openDelay={400}>
                <Button onClick={openInCell} size="xs" p="0" mx="2px" colorScheme={'yellow'} isDisabled={!canDeleteApp}>
                  <FaPython size="18px" />
                </Button>
              </Tooltip>

              <Tooltip placement="top" hasArrow={true} label={'Close the selected Apps'} openDelay={400}>
                <Button onClick={deleteOnOpen} size="xs" p="0" mx="2px" colorScheme={'red'} isDisabled={!canDeleteApp}>
                  <HiOutlineTrash size="18px" />
                </Button>
              </Tooltip>
            </Box>
          </Box>
        </Box >
      )
      }

      <ConfirmModal
        isOpen={deleteIsOpen}
        onClose={deleteOnClose}
        onConfirm={closeSelectedApps}
        title="Close Selected Apps"
        message={`Are you sure you want to close the selected ${lassoApps.length > 1 ? `${lassoApps.length} apps?` : 'app?'} `}
        cancelText="Cancel"
        confirmText="Yes"
        confirmColor="teal"
      ></ConfirmModal>
    </>
  );
}

/**
 * Packing function
 */

const GrowingPacker = function () { };

GrowingPacker.prototype = {

  fit: function (blocks: any[]) {
    var n,
      node,
      block,
      len = blocks.length;
    var w = len > 0 ? blocks[0].w : 0;
    var h = len > 0 ? blocks[0].h : 0;
    this.root = { x: 0, y: 0, w: w, h: h };
    for (n = 0; n < len; n++) {
      block = blocks[n];
      if ((node = this.findNode(this.root, block.w, block.h)))
        block.fit = this.splitNode(node, block.w, block.h);
      else block.fit = this.growNode(block.w, block.h);
    }
  },

  findNode: function (root: any, w: number, h: number) {
    if (root.used)
      return this.findNode(root.right, w, h) || this.findNode(root.down, w, h);
    else if (w <= root.w && h <= root.h) return root;
    else return null;
  },

  splitNode: function (node: any, w: number, h: number) {
    node.used = true;
    node.down = { x: node.x, y: node.y + h, w: node.w, h: node.h - h };
    node.right = { x: node.x + w, y: node.y, w: node.w - w, h: h };
    return node;
  },

  growNode: function (w: number, h: number) {
    var canGrowDown = w <= this.root.w;
    var canGrowRight = h <= this.root.h;

    var shouldGrowRight = canGrowRight && this.root.h >= this.root.w + w; // attempt to keep square-ish by growing right when height is much greater than width
    var shouldGrowDown = canGrowDown && this.root.w >= this.root.h + h; // attempt to keep square-ish by growing down  when width  is much greater than height

    if (shouldGrowRight) return this.growRight(w, h);
    else if (shouldGrowDown) return this.growDown(w, h);
    else if (canGrowRight) return this.growRight(w, h);
    else if (canGrowDown) return this.growDown(w, h);
    else return null; // need to ensure sensible root starting size to avoid this happening
  },

  growRight: function (w: number, h: number) {
    this.root = {
      used: true,
      x: 0,
      y: 0,
      w: this.root.w + w,
      h: this.root.h,
      down: this.root,
      right: { x: this.root.w, y: 0, w: w, h: this.root.h },
    };
    const node = this.findNode(this.root, w, h);
    if (node) return this.splitNode(node, w, h);
    else return null;
  },

  growDown: function (w: number, h: number) {
    this.root = {
      used: true,
      x: 0,
      y: 0,
      w: this.root.w,
      h: this.root.h + h,
      down: { x: 0, y: this.root.h, w: this.root.w, h: h },
      right: this.root,
    };
    const node = this.findNode(this.root, w, h);
    if (node) return this.splitNode(node, w, h);
    else return null;
  },
};

