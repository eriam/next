/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Button, Input, Textarea, VStack, RadioGroup, Radio, Text } from '@chakra-ui/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAppStore, useCredentials, useUser } from '@sage3/frontend';
import { App } from '../../schema';
import { AppWindow } from '../../components';

import { state as AppState } from './index';

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication failed — check the selected key.',
  unreachable: 'Could not reach that host.',
  tmux_failed: 'Connected, but starting tmux failed on the remote host.',
  credential_unavailable: 'That stored credential is unavailable — try re-entering it.',
};

function SetupForm(props: App): JSX.Element {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [credentialId, setCredentialId] = useState('');
  const [showNewCredentialForm, setShowNewCredentialForm] = useState(false);
  const [newCredentialName, setNewCredentialName] = useState('');
  const [username, setUsername] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { credentials, loading: credentialsLoading } = useCredentials('sshPrivateKey');
  const updateState = useAppStore((state) => state.updateState);
  const { user } = useUser();

  // No existing key to pick from — go straight to the "enter a new key" form.
  useEffect(() => {
    if (!credentialsLoading && credentials.length === 0) {
      setShowNewCredentialForm(true);
    }
  }, [credentialsLoading, credentials.length]);

  const canConnect = Boolean(host && (credentialId || (showNewCredentialForm && newCredentialName && username && privateKey)));

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { appId: props._id, host, port };
      if (showNewCredentialForm) {
        body.newCredential = {
          name: newCredentialName,
          value: { type: 'sshPrivateKey', username, privateKey, passphrase: passphrase || undefined },
        };
      } else {
        body.credentialId = credentialId;
      }
      const resp = await fetch('/api/integrations/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(ERROR_MESSAGES[data.error] || 'Connection failed.');
        return;
      }
      // credentialId comes back from the server rather than reusing the
      // local `credentialId` state, since that's empty on the newCredential
      // path — the server resolves it to whatever it just persisted. This
      // has to be in the app's own state, not just this component's: when
      // the last viewer leaves, the SSH connection is torn down, and a
      // later reconnect (leaving and returning to the board) needs it to
      // look up the credential again.
      // ownerId is stored here too, not just credentialId — main.ts's
      // getAppState() (used on every reconnect after the last viewer
      // leaves) reads it from this app's own persisted state, not from
      // whichever browser session triggers the reconnect. Without it,
      // getDecryptedValue(credentialId, ownerId) never matches the
      // credential's real owner and every reconnect fails.
      updateState(props._id, {
        host,
        port,
        credentialId: data.credentialId,
        ownerId: user?._id,
        connected: true,
      } as Partial<AppState>);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Box p={4} overflowY="auto" maxHeight="100%">
      <VStack align="stretch" spacing={3}>
        <Input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />

        {credentials.length > 0 && !showNewCredentialForm && (
          <>
            <RadioGroup value={credentialId} onChange={setCredentialId}>
              <VStack align="stretch">
                {credentials.map((c) => (
                  <Radio key={c.id} value={c.id}>
                    {c.name}
                  </Radio>
                ))}
              </VStack>
            </RadioGroup>
            <Button size="sm" variant="link" onClick={() => setShowNewCredentialForm(true)}>
              + Use a new key instead
            </Button>
          </>
        )}

        {showNewCredentialForm && (
          <VStack align="stretch" spacing={2} borderWidth={1} borderRadius="md" p={3}>
            <Text fontSize="sm" fontWeight="bold">
              New SSH key
            </Text>
            <Input
              placeholder="Name (e.g. my-server-key)"
              value={newCredentialName}
              onChange={(e) => setNewCredentialName(e.target.value)}
            />
            <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Textarea
              placeholder="Private key (paste the full contents, e.g. -----BEGIN OPENSSH PRIVATE KEY-----...)"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={6}
              fontFamily="mono"
              fontSize="xs"
            />
            <Input
              placeholder="Passphrase (optional)"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            {credentials.length > 0 && (
              <Button size="sm" variant="link" onClick={() => setShowNewCredentialForm(false)}>
                Use an existing key instead
              </Button>
            )}
          </VStack>
        )}

        {error && <Text color="red.400">{error}</Text>}
        <Button onClick={handleConnect} isLoading={connecting} isDisabled={!canConnect}>
          Connect
        </Button>
      </VStack>
    </Box>
  );
}

function TerminalView(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const { user } = useUser();
  const updateState = useAppStore((state) => state.updateState);
  const containerRef = useRef<HTMLDivElement>(null);

  const isController = s.controllerId === user?._id;
  const isControllerRef = useRef(isController);
  useEffect(() => {
    isControllerRef.current = isController;
  }, [isController]);

  useEffect(() => {
    const term = new Terminal({ convertEol: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (containerRef.current) {
      term.open(containerRef.current);
      fitAddon.fit();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ssh?appId=${props._id}`;
    console.log('SSHTerminal> opening WebSocket', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('SSHTerminal> WebSocket open');
      // A viewer joining an already-running tmux session only receives output
      // emitted after it connects; a static screen (an idle shell prompt) would
      // stay blank until the next keystroke. A *same-size* resize is a no-op in
      // tmux, so it won't repaint. Jiggle the row count by one and restore it —
      // the size CHANGE forces tmux to redraw its full current screen, which is
      // the only reliable way a fresh viewer sees the existing prompt.
      fitAddon.fit();
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'resize', cols, rows: Math.max(1, rows - 1) }));
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }, 120);
    };

    ws.onerror = (event) => {
      console.error('SSHTerminal> WebSocket error', event);
    };

    ws.onclose = (event) => {
      console.log('SSHTerminal> WebSocket closed', event?.code, event?.reason);
    };

    ws.onmessage = (event) => {
      let message: { type: string; data?: string; connected?: boolean };
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        console.error('SSHTerminal> failed to parse WebSocket message', event.data, err);
        return;
      }
      console.log('SSHTerminal> received message', message);
      if (message.type === 'output' && message.data !== undefined) {
        term.write(message.data);
      } else if (message.type === 'status') {
        updateState(props._id, { connected: message.connected } as Partial<AppState>);
      }
    };

    const dataDisposable = term.onData((data) => {
      if (isControllerRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props._id]);

  function handleTakeControl() {
    if (!user) return;
    updateState(props._id, { controllerId: user._id } as Partial<AppState>);
  }

  return (
    <Box position="relative" width="100%" height="100%">
      <Box ref={containerRef} width="100%" height="100%" />
      {!isController && (
        <Button position="absolute" top={2} right={2} size="sm" onClick={handleTakeControl}>
          Take control
        </Button>
      )}
    </Box>
  );
}

function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  return (
    <AppWindow app={props}>
      {!s.host ? <SetupForm {...props} /> : <TerminalView {...props} />}
    </AppWindow>
  );
}

function ToolbarComponent(): JSX.Element {
  return <></>;
}

const GroupedToolbarComponent = () => {
  return null;
};

export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };
