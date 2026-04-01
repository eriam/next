# pysage3 — package internals

This is the `pysage3` Python package. For usage documentation see the [top-level README](../README.md).

## Structure

```
pysage3/
  client.py              # PySage3 — main API client class
  proxy.py               # SAGEProxy — long-running event-driven daemon
  smartbits/             # SmartBit classes (one per SAGE3 app type)
  utils/
    sage_communication.py  # HTTP REST client
    sage_websocket.py      # WebSocket client (real-time subscriptions)
  config/                # Configuration loader
  board.py               # Board container with layout helpers
  room.py                # Room container
  smartbitfactory.py     # Instantiates the correct SmartBit from a server doc
  jupyterkernelproxy.py  # Connects to Jupyter Kernel Gateway for SageCell execution
```

## Running the proxy daemon

```bash
cd pysage3
pip install -r requirements.txt
python proxy.py
```
