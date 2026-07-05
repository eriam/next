/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState } from 'react';
import { Box, Button, Input, VStack, RadioGroup, Radio, Text } from '@chakra-ui/react';
import { useAppStore, useCredentials } from '@sage3/frontend';
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
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { credentials } = useCredentials('sshPrivateKey');
  const updateState = useAppStore((state) => state.updateState);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const resp = await fetch('/api/integrations/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: props._id, host, port, credentialId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(ERROR_MESSAGES[data.error] || 'Connection failed.');
        return;
      }
      updateState(props._id, { host, port, credentialId, connected: true } as Partial<AppState>);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Box p={4}>
      <VStack align="stretch" spacing={3}>
        <Input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
        <RadioGroup value={credentialId} onChange={setCredentialId}>
          <VStack align="stretch">
            {credentials.map((c) => (
              <Radio key={c.id} value={c.id}>
                {c.name}
              </Radio>
            ))}
          </VStack>
        </RadioGroup>
        {error && <Text color="red.400">{error}</Text>}
        <Button onClick={handleConnect} isLoading={connecting} isDisabled={!host || !credentialId}>
          Connect
        </Button>
      </VStack>
    </Box>
  );
}

function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  return (
    <AppWindow app={props}>
      {!s.host ? (
        <SetupForm {...props} />
      ) : (
        <Box p={4}>
          <Text>Terminal view — added in a later task.</Text>
        </Box>
      )}
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
