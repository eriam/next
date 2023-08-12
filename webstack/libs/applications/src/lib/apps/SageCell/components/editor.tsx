/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// React imports
import { useCallback, useEffect, useRef, useState } from 'react';

// Chakra Imports
import { useColorModeValue, useToast, Flex, Box, ButtonGroup, IconButton, Spinner, Tooltip, Spacer, Text } from '@chakra-ui/react';
import { MdClearAll, MdPlayArrow, MdStop } from 'react-icons/md';

// Monaco Imports
import { useMonaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { monacoOptions } from './monacoOptions';

// Yjs Imports
import { MonacoBinding } from 'y-monaco';
import { useYjs } from '@sage3/frontend';

// SAGE3 imports
import { useHexColor, useKernelStore, useAppStore, useUser, useUsersStore, FastAPI } from '@sage3/frontend';

// App Imports
import { state as AppState } from '../index';
import { App } from '../../../schema';
import { throttle } from 'throttle-debounce';

// Code Editor Props
type CodeEditorProps = {
  app: App;
  access: boolean; // Does this user have access to the sagecell's selected kernel
  editorHeight?: number;
  online: boolean;
};

/**
 * Editor component for the SageCell application
 * @param props
 * @returns
 */
export function CodeEditor(props: CodeEditorProps): JSX.Element {
  // App State
  const s = props.app.data.state as AppState;
  const updateState = useAppStore((state) => state.updateState);

  // Styling
  const defaultTheme = useColorModeValue('vs', 'vs-dark');

  // Users
  const users = useUsersStore((state) => state.users);
  const { user } = useUser();
  const userId = user?._id;
  const userInfo = users.find((u) => u._id === userId)?.data;
  const userName = userInfo?.name;
  const userColor = useHexColor(userInfo?.color as string);

  // Room and Board info
  const roomId = props.app.data.roomId;
  const boardId = props.app.data.boardId;

  // Local state
  const [fontSize, setFontSize] = useState(s.fontSize);
  const [numClients, setNumClients] = useState<number>(0);
  const [cursorPosition, setCursorPosition] = useState({ r: 0, c: 0 });

  // Kernel Store
  const { apiStatus, executeCode } = useKernelStore((state) => state);

  const [count, setCount] = useState(0);

  // Toast
  const toast = useToast();

  // YJS and Monaco
  const { yText, provider } = useYjs({ appId: props.app._id });
  const element = useRef<null | HTMLDivElement>(null);
  const monaco = useMonaco();
  const [model, setModel] = useState<null | monaco.editor.ITextModel>(null);
  const [editor, setEditor] = useState<null | monaco.editor.IStandaloneCodeEditor>(null);
  const [binding, setBinding] = useState<null | MonacoBinding>(null);

  useEffect(() => {
    // This gets called when the editor is mounted
    if (monaco && element.current) {
      const model = monaco.editor.createModel(s.code, s.language);
      const editor = monaco.editor.create(element.current, {
        ...monacoOptions,
        model: model,
        fontSize: s.fontSize,
        language: s.language,
        theme: defaultTheme,
        domReadOnly: !props.access,
      });
      editor.addAction({
        id: 'execute',
        label: 'Execute',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
        run: handleExecute,
      });
      editor.addAction({
        id: 'increase-font-size',
        label: 'Increase Font Size',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal],
        run: () => {
          setFontSize((prevSize) => prevSize + 1);
        },
      });
      editor.addAction({
        id: 'decrease-font-size',
        label: 'Decrease Font Size',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus],
        run: () => {
          setFontSize((prevSize) => prevSize - 1);
        },
      });
      editor.addAction({
        id: 'reset-font-size',
        label: 'Reset Font Size',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR],
        run: () => {
          setFontSize(s.fontSize);
        },
      });
      editor.addAction({
        id: 'save',
        label: 'Save',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          const text = editor.getValue();
          if (text) {
            updateState(props.app._id, { code: text });
            console.log('saving code');
          }
        },
      });
      editor.onDidChangeCursorPosition((ev) => {
        setCursorPosition({ r: ev.position.lineNumber, c: ev.position.column });
        throttleFunc();
      });
      setModel(model);
      setEditor(editor);
    }
    return () => {
      if (editor) {
        console.log('disposing editor');
        editor.dispose();
        setEditor(null);
      }
      if (model) {
        console.log('disposing model');
        model.dispose();
        setModel(null);
      }
    };
    // }, []);
  }, [monaco, element, s.code, s.language, s.fontSize]);

  useEffect(() => {
    if (editor && yText && model && provider && binding === null) {
      if (yText.toString() === '' && props.app._updatedBy === user?._id) {
        console.log('insert yText');
        yText.insert(0, editor.getValue());
      }
      provider.awareness.setLocalStateField('user', {
        id: user?._id,
        name: userName,
        color: userColor,
      });
      provider.awareness.setLocalStateField('cursor', {
        position: editor.getPosition(),
        selection: editor.getSelection(),
      });
      provider.awareness.on('change', () => {
        // Update cursor colors based on user color
        const states = provider.awareness.getStates();
        // get a list of the number of unique clients in the room
        for (const [clientId, state] of states.entries()) {
          // Ignore local client state
          if (clientId !== provider.awareness.clientID) {
            // Create new style element
            const style = document.createElement('style');
            style.id = `style-${clientId}`;
            // Apply user color and name to CSS
            const css = `
              .yRemoteSelection-${clientId} {
                background-color: ${state.user.color} !important;
                margin-left: -1px;
                margin-right: -1px;
                pointer-events: none;
                position: relative;
                word-break: normal;
              }

              .yRemoteSelection-${clientId} {
                border-left: 1px solid ${state.user.color} !important;
                border-right: 1px solid ${state.user.color} !important;
              }

              .monaco-editor-overlaymessage {
                transform: scale(0.8);
              }
            `;

            style.appendChild(document.createTextNode(css));
            // Remove old style element if it exists
            const oldStyle = document.getElementById(`style-${clientId}`);
            if (oldStyle) {
              document.head.removeChild(oldStyle);
            }
            // Append the style element to the document head
            document.head.appendChild(style);
          }
        }
        // Update the number of clients in the room
        setNumClients(states.size);
      });
      editor.updateOptions({
        readOnly: !props.access,
      });
      console.log('creating binding');
      setBinding(new MonacoBinding(yText, model, new Set([editor]), provider.awareness));
    }

    return () => {
      setCount((prevCount) => prevCount + 1);
      console.log('count line 257: ', count);

      if (provider) provider?.disconnect();
      if (binding) binding.destroy();
      // do not dispose model or editor
      setBinding(null);
    };
  }, [editor, model, provider]);

  /**
   * Resizes the editor when the window is resized
   * or when the editorHeight changes.
   *
   * This is needed because the editor is not responsive
   * and automaticLayout is set to false to make the editor
   * resizeable and not trigger a ResizeObserver loop limit
   * exceeded error.
   */
  useEffect(() => {
    console.log('resizing editor');
    if (editor) {
      editor.layout({
        width: props.app.data.size.width - 60,
        height: props.editorHeight && props.editorHeight > 150 ? props.editorHeight : 150,
        minHeight: '100%',
        minWidth: '100%',
      } as monaco.editor.IDimension);
    }
  }, [editor, props.app.data.size.width, props.editorHeight]);

  useEffect(() => {
    console.log('updating fontSize');
    editor?.updateOptions({
      fontSize: fontSize,
    });
  }, [editor, fontSize]);

  // Debounce Updates
  const throttleUpdate = throttle(1000, () => {
    if (editor) {
      const text = editor?.getValue();
      updateState(props.app._id, { code: text });
    }
  });
  // Keep a copy of the function
  const throttleFunc = useCallback(throttleUpdate, [editor]);

  /**
   * Executes the code in the editor
   * @returns void
   * TODO: Add a check to see if the kernel is still running
   */
  const handleExecute = async () => {
    console.log('handleExecute');
    if (!user || !editor || !apiStatus || !props.access) return;
    if (!s.kernel) {
      toast({
        title: 'No kernel selected',
        description: 'Please select a kernel from the toolbar',
        status: 'error',
        duration: 4000,
        isClosable: true,
        position: 'bottom',
      });
      return;
    }
    if (!props.access) {
      toast({
        title: 'You do not have access to this kernel',
        description: 'Please select a different kernel from the toolbar',
        status: 'error',
        duration: 4000,
        isClosable: true,
        position: 'bottom',
      });
      return;
    }
    if (editor.getValue() && editor.getValue().slice(0, 6) === '%%info') {
      const info = `room_id = '${roomId}'\nboard_id = '${boardId}'\nprint('room_id = ' + room_id)\nprint('board_id = ' + board_id)`;
      editor.setValue(info);
    }
    try {
      const response = await executeCode(editor.getValue(), s.kernel, user._id);
      if (response.ok) {
        const msgId = response.msg_id;
        updateState(props.app._id, {
          msgId: msgId,
          session: user._id,
        });
      } else {
        console.log('Error executing code');
        updateState(props.app._id, {
          streaming: false,
          msgId: '',
        });
      }
    } catch (error) {
      if (error instanceof TypeError) {
        console.log(`The Jupyter proxy server appears to be offline. (${error.message})`);
        updateState(props.app._id, {
          streaming: false,
          kernel: '',
          kernels: [],
          msgId: '',
        });
      }
    }
  };

  /**
   * Clears the code and the msgId from the state
   * and resets the editor to an empty string
   * @returns void
   */
  const handleClear = () => {
    updateState(props.app._id, {
      code: '',
      msgId: '',
      streaming: false,
    });
    editor?.setValue('');
  };

  // Handle interrupt
  const handleInterrupt = () => {
    // send signal to interrupt the kernel via http request
    // FastAPI.interruptKernel(s.kernel);
    updateState(props.app._id, {
      msgId: '',
      streaming: false,
    });
  };

  /**
   * Needs to be reset every time the kernel changes
   */
  useEffect(() => {
    setCount((prevCount) => prevCount + 1);

    if (editor && s.kernel && props.access && monaco) {
      editor.onDidAttemptReadOnlyEdit(() => {
        toast({
          title: 'You do not have access to this kernel',
          description: 'Please select a different kernel from the toolbar',
          status: 'error',
          duration: 4000,
          isClosable: true,
          position: 'bottom',
        });
      });
      editor.addAction({
        id: 'execute',
        label: 'Execute',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
        run: handleExecute,
      });
      setEditor(editor);
    }
  }, [editor, monaco, s.kernel]);

  return (
    <>
      <Flex direction={'row'}>
        <Flex direction={'column'}>
          {/* <div ref={element} style={{ width: '100%', height: '100%' }} /> */}
          <div ref={element} />
          <Flex px={1} h={'24px'} fontSize={'16px'} color={userColor} justifyContent={'left'}>
            {numClients > 1 ? 'Online:' + numClients : null}
            <Spacer />
            {cursorPosition.r > 0 && cursorPosition.c > 0 ? `Ln: ${cursorPosition.r} Col: ${cursorPosition.c}` : null}
          </Flex>
        </Flex>
        <Box p={1}>
          <ButtonGroup isAttached variant="outline" size="lg" orientation="vertical">
            <Tooltip hasArrow label="Execute" placement="right-start">
              <IconButton
                onClick={handleExecute}
                aria-label={''}
                icon={s.streaming ? <Spinner size="sm" color="teal.500" /> : <MdPlayArrow size={'1.5em'} color="#008080" />}
                isDisabled={!s.kernel}
              />
            </Tooltip>
            <Tooltip hasArrow label="Stop" placement="right-start">
              <IconButton
                onClick={handleInterrupt}
                aria-label={''}
                isDisabled={!s.streaming}
                icon={<MdStop size={'1.5em'} color="#008080" />}
              />
            </Tooltip>
            <Tooltip hasArrow label="Clear All" placement="right-start">
              <IconButton
                onClick={handleClear}
                aria-label={''}
                isDisabled={!s.kernel}
                icon={<MdClearAll size={'1.5em'} color="#008080" />}
              />
            </Tooltip>
          </ButtonGroup>
        </Box>
      </Flex>
    </>
  );
}
