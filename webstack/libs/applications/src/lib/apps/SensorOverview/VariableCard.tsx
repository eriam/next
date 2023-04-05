/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import React from 'react';

import { Box, Button, Text } from '@chakra-ui/react';

export default function VariableCard(props: {
  variableName: string;
  variableValue: string;
  isEnabled?: boolean;
  showDeleteButton?: boolean;
  handleDeleteWidget?: (index: number) => void;
  index?: number;
}) {
  return (
    <>
      <Box p="1rem" w="300px" h="300px" border="solid white 1px" bgColor={props.isEnabled ? 'blackAlpha.200' : 'blackAlpha.700'}>
        {props.showDeleteButton ? (
          <Button
            onClick={() => {
              if (props.handleDeleteWidget) props.handleDeleteWidget(props.index ? props.index : 0);
            }}
          >
            Delete
          </Button>
        ) : null}

        <Text textAlign={'center'}>
          <strong>{props.variableName}</strong>
        </Text>
        <Text lineHeight={'7rem'} textAlign="center" fontSize={'xl'} verticalAlign={'middle'}>
          <strong>{props.variableValue}</strong>
        </Text>
      </Box>
    </>
  );
}
