/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { RoomMembersSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter } from '@sage3/backend';
import { RoomsCollection } from './rooms';

class SAGE3RoomMembersCollection extends SAGE3Collection<RoomMembersSchema> {
  constructor() {
    super('ROOMMEMBERS', {
      roomId: '',
    });

    const router = sageRouter<RoomMembersSchema>(this);

    router.post('/join', async ({ body, user }, res) => {
      // console.log('Joining room', body);
      let doc = null;
      const userId = (user as any).id;
      const roomId = body.roomId;

      if (userId && roomId) {
        // Get the current doc if it exists
        const currentDoc = await this.get(roomId);
        if (currentDoc) {
          // Update the doc with the new member
          let members = [...currentDoc.data.members, userId];
          members = removeDuplicates(members);
          doc = await this.update(roomId, userId, { members });
        } else {
          // Create a new doc
          doc = await this.add({ roomId, members: [userId] }, userId, roomId);
        }
      }
      if (doc) res.status(200).send({ success: true, data: [doc] });
      else res.status(500).send({ success: false, message: 'Failed to join room.' });
    });

    router.post('/leave', async ({ body, user }, res) => {
      let doc = null;
      const userId = (user as any).id;
      const roomId = body.roomId;
      if (userId && roomId) {
        // Get the current doc if it exists
        const currentDoc = await this.get(roomId);
        if (currentDoc) {
          // Update the doc with removing the member
          let members = currentDoc.data.members.filter((member: string) => member !== userId);
          members = removeDuplicates(members);
          doc = await this.update(roomId, userId, { members });
          if (doc) res.status(200).send({ success: true, data: [doc] });
        } else {
          res.status(500).send({ success: false, message: 'Failed to leave room.' });
        }
      } else res.status(500).send({ success: false, message: 'Failed to leave room.' });
    });

    router.post('/remove', async ({ body, user }, res) => {
      let doc = null;
      const userId = body.userId;
      const roomId = body.roomId;
      if (userId && roomId) {
        // Get the current doc if it exists
        const currentDoc = await this.get(roomId);
        if (currentDoc) {
          // Check if the user making the request is the owner of the room
          const room = await RoomsCollection.get(roomId);
          if (room && room?.data.ownerId !== (user as any).id) {
            res.status(500).send({ success: false, message: 'You are not the owner of the room.' });
            return;
          }
          // Update the doc with removing the member
          let members = currentDoc.data.members.filter((member: string) => member !== userId);
          members = removeDuplicates(members);
          doc = await this.update(roomId, userId, { members });
          if (doc) res.status(200).send({ success: true, data: [doc] });
        } else {
          res.status(500).send({ success: false, message: 'Failed to remove user from room.' });
        }
      } else res.status(500).send({ success: false, message: 'Failed to remove user from room.' });
    });

    this.httpRouter = router;
  }
}

// Take and array and remove all duplicates
function removeDuplicates(arr: string[]) {
  return [...new Set(arr)];
}

export const RoomMembersCollection = new SAGE3RoomMembersCollection();
