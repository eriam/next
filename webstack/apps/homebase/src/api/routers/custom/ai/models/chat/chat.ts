/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { AiModel } from '../AbstractAiModel';
import { ServerConfiguration } from '@sage3/shared/types';

// Response Types
import { AiQueryResponse } from '@sage3/shared';

export class ChatModel extends AiModel {
  private _url: string;
  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;
  public name = 'chat';

  constructor(config: ServerConfiguration) {
    super();
    this._url = config.services.chat.url;
    this._apiKey = config.services.chat.apiKey;
    this._model = config.services.chat.model;
    this._maxTokens = config.services.chat.max_tokens;
  }

  public info() {
    return { name: this.name, model: this._model, maxTokens: this._maxTokens };
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

  public async query(input: string): Promise<AiQueryResponse> {
    try {
      const modelBody = {
        inputs: input,
        parameters: {
          max_new_tokens: this._maxTokens,
        },
      };
      const response = await fetch(`${this._url}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelBody),
      });
      if (response.status == 200) {
        const data = await response.json();
        return {
          success: true,
          output: data.generated_text,
        };
      } else {
        return {
          success: false,
          error_message: 'Failed to query chat model.',
        };
      }
    } catch (error) {
      return {
        success: false,
        error_message: `Failed to query chat model: ${error.message}`,
      };
    }
  }
}
