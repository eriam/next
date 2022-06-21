import asyncio
from urllib import response
import websockets
import requests
import json
import uuid

# pretty print for dictionaries
import pprint
printer = pprint.PrettyPrinter(indent=1, depth=5, width=120, compact=True)

# server info
server = 'localhost:3333'
web_server = 'http://' + server
socket_server = 'ws://' + server
socket_path = '/api'

myID = ''

token = ''
with open('token1.json') as f:
    data = json.load(f)
    token = data['token']
print('Token:', token)


def processBoardMessage(msg):
    """Process an update about a board
    """
    type = msg['type']
    data = msg['doc']['data']
    if type == 'CREATE':
        print('New app> ', data)
    if type == 'DELETE':
        print('Delete app> ', data)
    if type == 'UPDATE':
        print('Update app> ', data)


async def subscribeToAppUpdateInBoard(sock, boardId):
    """Get new, delete, and update messages for a board
    """
    messageId = str(uuid.uuid4())
    print('Subscribing to board:', boardId,
          'with subscriptionId:', messageId)
    msg_sub = {
        'route': '/api/subscription/boards/' + boardId,
        'id': messageId,
        'method': 'SUB'
    }
    # send the message
    await sock.send(json.dumps(msg_sub))


async def main():

    async with websockets.connect(socket_server + socket_path, extra_headers={"Authorization": f"Bearer {token}"}) as ws:
        # async with websockets.connect(socket_server + socket_path) as ws:
        print('connected')
        # subscribe to the collection: id is subscription identifier
        await subscribeToAppUpdateInBoard(ws, "f53f6062-8bee-426e-a81a-f9ebb88371ba")

        # loop to receive messages
        async for msg in ws:
            event = json.loads(msg)
            processBoardMessage(event['event'])

if __name__ == '__main__':
    asyncio.run(main())
