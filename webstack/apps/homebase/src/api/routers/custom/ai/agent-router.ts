/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { config } from 'apps/homebase/src/config';
import * as express from 'express';

import { AgentQueryType, AgentQueryResponse, AiQueryResponse } from '@sage3/shared';

export function AgentRouter(): express.Router {
  const router = express.Router();
  const session = new LangChainModel();

  // Check if the langchain is healthy
  router.get('/status', async (req, res) => {
    // Ask the langchain if it is healthy
    const response = await session.health();
    if (response) {
      const responseMessage: AiQueryResponse = { success: true, error_message: '' };
      res.status(200).json(responseMessage);
    } else {
      const responseMessage: AiQueryResponse = { success: true, error_message: 'LangChain is unhealthy' };
      res.status(500).json(responseMessage);
    }
  });

  // Post a chat request
  router.post('/ask', async ({ body }, res) => {
    // Try/catch block to handle errors
    try {
      // Query langchain with the input
      const response = await session.ask(body);
      if (response.success) {
        // Return the response
        res.status(200).json(response);
      } else {
        // Return an error message if the request fails
        const responseMessage = { success: false, error_message: response.r } as AiQueryResponse;
        res.status(500).json(responseMessage);
      }
    } catch (error) {
      // Return an error message if the request fails
      const responseMessage = { success: false, error_message: error.toString() } as AiQueryResponse;
      res.status(500).json(responseMessage);
    }
  });

  // Post a summary request
  router.post('/summary', async (req, res) => {
    const body: AgentQueryType = req.body;

    // Try/catch block to handle errors
    try {
      // Query langchain with the input
      const response = await session.summary(body);
      if (response.success) {
        // Return the response
        res.status(200).json(response);
      } else {
        // Return an error message if the request fails
        const responseMessage = { success: false, error_message: response.r } as AiQueryResponse;
        res.status(500).json(responseMessage);
      }
    } catch (error) {
      // Return an error message if the request fails
      const responseMessage = { success: false, error_message: error.toString() } as AiQueryResponse;
      res.status(500).json(responseMessage);
    }
  });

  return router;
}

////////////////////////////////

export abstract class AgentModel {
  // Name of model
  abstract name: string;
  // Check if this AiModel is healthy to use
  abstract health(): Promise<boolean>;
  // The express router for this AiModel
  abstract ask(request: AgentQueryType): Promise<AgentQueryResponse>;
}

export class LangChainModel extends AgentModel {
  private _url: string;
  public name = 'langchain';

  constructor() {
    super();
    this._url = config.agents.url;
  }

  public async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this._url}/health`, { method: 'GET' });
      if (response.status === 200) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
  }

  public async ask(request: AgentQueryType): Promise<AgentQueryResponse> {
    try {
      const response = await fetch(`${this._url}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (response.status == 200) {
        const data: AgentQueryResponse = await response.json();
        return data;
      } else {
        const error = await response.json();
        return {
          success: false,
          id: request.id,
          r: error.detail,
        };
      }
    } catch (error) {
      return {
        success: false,
        id: request.id,
        r: `Failed to query  ${this.name}: ${error.message}`,
      };
    }
  }

  public async summary(request: AgentQueryType): Promise<AgentQueryResponse> {
    try {
      const response = await fetch(`${this._url}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (response.status == 200) {
        const data: AgentQueryResponse = await response.json();
        return data;
      } else {
        const error = await response.json();
        return {
          success: false,
          id: request.id,
          r: error.detail,
        };
      }
    } catch (error) {
      return {
        success: false,
        id: request.id,
        r: `Failed to query  ${this.name}: ${error.message}`,
      };
    }
  }
}
