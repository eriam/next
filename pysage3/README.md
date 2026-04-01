# pysage3

Python client library for [SAGE3](https://sage3.app) — a collaborative web-based workspace.

Use `pysage3` to programmatically create, read, update, and delete apps on a SAGE3 board from Python scripts, Jupyter notebooks, or AI/ML services.

## Install

```bash
pip install pysage3
```

Or directly from the repo (development):

```bash
pip install git+https://github.com/SAGE-3/next.git@dev#subdirectory=pysage3
```

## Configuration

Set the following environment variables (or use a `.env` file):

```
SAGE3_SERVER=example.com
ENVIRONMENT=production
TOKEN=<your SAGE3 JWT token>
```

## Usage

```python
from pysage3 import PySage3
from pysage3.config import config as conf, prod_type

# Connect to the SAGE3 server
ps3 = PySage3(conf, prod_type)

# Get all apps on a board as SmartBit objects
smartbits = ps3.get_smartbits(room_id, board_id)

# Filter by type
stickies = ps3.get_smartbits_by_type('Stickie', room_id, board_id)

# Update an app's state
for s in stickies.values():
    s.state.text = "Updated!"
    s.send_updates()

# Create a new app
ps3.create_app(room_id, board_id, 'Stickie', {'text': 'Hello from Python', 'color': 'yellow'})
```

## SageCell / Jupyter Usage

Inside a SageCell on a SAGE3 board, magic variables are injected automatically:

```python
from pysage3 import PySage3
from pysage3.config import config as conf, prod_type

room_id = %%sage_room_id
board_id = %%sage_board_id
selected_apps = %%sage_selected_apps

ps3 = PySage3(conf, prod_type)
smartbits = ps3.get_smartbits(room_id, board_id)
bits = [smartbits[a] for a in selected_apps]
for b in bits:
    print(b)
```

## SAGEProxy (server daemon)

`SAGEProxy` is a long-running daemon that watches a SAGE3 server for changes and can react to them — for example, executing code when a SageCell's `executeInfo` is triggered.

```bash
python -m pysage3.proxy
```

See `pysage3/proxy.py` for details on registering linked app callbacks.

## More

See the [SAGE3 docs](https://sage-3.github.io/docs/SAGE3-API-in-SageCell) for full API reference and examples.
