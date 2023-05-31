/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useAppStore, useCursorBoardPosition, useHexColor, useUIStore } from '@sage3/frontend';
import { Box, HStack, Text, Spinner, useColorModeValue, Wrap, WrapItem } from '@chakra-ui/react';
import { App } from '../../schema';

import { state as AppState } from './index';
import { AppWindow } from '../../components';
import GridLayout from 'react-grid-layout';

import ChartLayout from './components/ChartLayout';

// Styling
import './styling.css';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import VariableCard from '../HCDP/viewers/VariableCard';
import CustomizeWidgets from './components/CustomizeWidgets';
import EChartsViewer from './components/EChartsViewer';

function convertToFormattedDateTime(date: Date) {
  const now = new Date(date);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}`;
}

function formatDuration(ms: number) {
  if (ms < 0) ms = -ms;
  const mins = Math.floor(ms / 60000) % 60;
  if (mins > 0) {
    return `Refreshed ${mins} minutes ago`;
  } else {
    return `Refreshed less than a minute ago`;
  }
}

function getFormattedDateTime24HoursBefore() {
  const now = new Date();
  now.setHours(now.getHours() - 24);

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}`;
}

/* App component for Sensor Overview */

function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  const updateState = useAppStore((state) => state.updateState);
  const [stationMetadata, setStationMetadata] = useState([]);
  const scale = useUIStore((state) => state.scale);

  const bgColor = useColorModeValue('gray.100', 'gray.900');
  const textColor = useColorModeValue('gray.700', 'gray.100');

  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [timeSinceLastUpdate, setTimeSinceLastUpdate] = useState<string>(formatDuration(Date.now() - lastUpdate));

  useEffect(() => {
    const updateTimesinceLastUpdate = () => {
      if (lastUpdate > 0) {
        const delta = Date.now() - lastUpdate;
        setTimeSinceLastUpdate(formatDuration(delta));
        console.log(formatDuration(delta));
      }
    };
    updateTimesinceLastUpdate();
    const interval = setInterval(() => {
      updateTimesinceLastUpdate();
    }, 1000 * 30); // 30 seconds
    return () => clearInterval(interval);
  }, [lastUpdate]);

  useEffect(() => {
    const fetchStationData = async () => {
      const tmpStationMetadata: any = [];
      for (let i = 0; i < s.stationNames.length; i++) {
        let url = '';
        if (props.data.state.widget.visualizationType === 'variableCard') {
          url = `https://api.mesowest.net/v2/stations/timeseries?STID=${
            s.stationNames[i]
          }&showemptystations=1&start=${getFormattedDateTime24HoursBefore()}&end=${convertToFormattedDateTime(
            new Date()
          )}&token=d8c6aee36a994f90857925cea26934be&complete=1&obtimezone=local`;
        } else {
          url = `https://api.mesowest.net/v2/stations/timeseries?STID=${s.stationNames[i]}&showemptystations=1&start=${
            props.data.state.widget.startDate
          }&end=${convertToFormattedDateTime(new Date())}&token=d8c6aee36a994f90857925cea26934be&complete=1&obtimezone=local`;
        }
        const response = await fetch(url);
        const sensor = await response.json();

        if (sensor) {
          const sensorData = sensor['STATION'][0];
          tmpStationMetadata.push(sensorData);
        }
      }
      setStationMetadata(tmpStationMetadata);
      // return tmpStationMetadata;
    };
    fetchStationData().catch((err) => {
      fetchStationData();
      console.log(err);
    });

    const interval = setInterval(
      () => {
        fetchStationData();
        setLastUpdate(Date.now());
      },
      60 * 10000
      //10 minutes
    );
    return () => clearInterval(interval);
  }, [JSON.stringify(s.stationNames)]);
  return (
    <AppWindow app={props}>
      <Box overflowY="auto" bg={bgColor} h="100%">
        {stationMetadata.length > 0 ? (
          <Box bgColor={bgColor} color={textColor} fontSize="lg">
            {/* <Text textAlign="center" fontSize={'4rem'}>
              TODO: PRINT ALL STATION NAMES
            </Text> */}
            <HStack>
              <Box>
                {s.widget.visualizationType === 'variableCard' ? (
                  <VariableCard
                    size={props.data.size}
                    variableName={s.widget.yAxisNames[0]}
                    state={props}
                    stationNames={s.stationNames}
                    startDate={s.widget.startDate}
                    stationMetadata={stationMetadata}
                    timeSinceLastUpdate={timeSinceLastUpdate}
                    isLoaded={true}
                  />
                ) : (
                  <EChartsViewer
                    stationNames={s.stationNames}
                    visualizationType={s.widget.visualizationType}
                    dateStart={''}
                    dateEnd={''}
                    timeSinceLastUpdate={timeSinceLastUpdate}
                    yAxisNames={s.widget.yAxisNames}
                    xAxisNames={s.widget.xAxisNames}
                    startDate={s.widget.startDate}
                    size={props.data.size}
                    stationMetadata={stationMetadata}
                  />
                )}
              </Box>
            </HStack>
          </Box>
        ) : (
          <Spinner
            w={Math.min(props.data.size.height / 2, props.data.size.width / 2)}
            h={Math.min(props.data.size.height / 2, props.data.size.width / 2)}
            thickness="20px"
            speed="0.30s"
            emptyColor="gray.200"
          />
        )}
      </Box>
    </AppWindow>
  );
}

/* App toolbar component for the app Sensor Overview */

function ToolbarComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  const updateState = useAppStore((state) => state.updateState);

  // const handleDeleteWidget = (widgetIndex: number) => {
  //   const tmpWidgetsEnabled = [...s.widgetsEnabled];
  //   tmpWidgetsEnabled.splice(widgetIndex, 1);
  //   updateState(props._id, { widgetsEnabled: tmpWidgetsEnabled });
  // };

  // const handleAddWidget = (visualizationType: string, yAxisNames: string[], xAxisNames: string[]) => {
  //   const tmpWidgetsEnabled = [...s.widgetsEnabled];
  //   tmpWidgetsEnabled.push({ visualizationType: visualizationType, yAxisNames: yAxisNames, xAxisNames: xAxisNames });
  //   console.log(tmpWidgetsEnabled);
  //   updateState(props._id, { widgetsEnabled: tmpWidgetsEnabled });
  // };
  return <>{/* <CustomizeWidgets props={props} size={props.data.size} widget={s.widget} /> */}</>;
}

export default { AppComponent, ToolbarComponent };
