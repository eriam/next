/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { AppSchema } from '@sage3/applications/schema';
import { SAGE3Collection, sageRouter } from '@sage3/backend';

class SAGE3AppsCollection extends SAGE3Collection<AppSchema> {
  constructor() {
    super('APPS', {
      roomId: '',
      boardId: '',
      type: 'Stickie',
    });
    const router = sageRouter<AppSchema>(this);
    this.httpRouter = router;
  }

  // Delete all the apps on a specific board
  public async deleteAppsOnBoard(boardId: string): Promise<number> {
    // Delete the apps on the board
    const boardApps = await this.query('boardId', boardId);
    const appsIds = boardApps ? boardApps.map((app) => app._id) : [];
    const appsDeleted = await this.deleteBatch(appsIds);
    return appsDeleted ? appsDeleted.length : 0;
  }

  // Delete all the apps of a specific user
  public async deleteUsersApps(userId: string): Promise<number> {
    // Delete the apps of the user
    const userApps = await this.query('_createdBy', userId);
    const appsIds = userApps ? userApps.map((app) => app._id) : [];
    const appsDeleted = await this.deleteBatch(appsIds);
    return appsDeleted ? appsDeleted.length : 0;
  }

  // Transfer all the apps of a user to another user
  public async transferUsersApps(oldUserId: string, newCreatedBy: string): Promise<boolean> {
    // Get all the apps of the user
    const userApps = await this.query('_createdBy', oldUserId);
    const appsIds = userApps ? userApps.map((app) => app._id) : [];
    // Update the createdBy field of the apps
    const appsUpdated = await Promise.all(appsIds.map((appId) => this.updateCreatedBy(appId, newCreatedBy)));
    return appsUpdated ? true : false;
  }
}

export const AppsCollection = new SAGE3AppsCollection();
