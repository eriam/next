import time

from foresight.ai.ai_client import AIClient
import uuid
from foresight.config import funcx as fcx_cfg
import pytest


@pytest.fixture
def ai_client():
    return AIClient(check_every=4)


def test_execute(ai_client):
    """
    test that we can
    1. submit a hello world job (response is of type UUID)
    2. the job has  a pending field
    """
    command_info = {
        'app_uuid': uuid.uuid4(),
        'msg_uuid': uuid.uuid4(),
        'callback_fn': lambda x: print(f"hello world and data is {x}"),
        'funcx_uuid': fcx_cfg["test_hello_world_uuid"],
        'endpoint_uuid': fcx_cfg["endpoint_uuid"],
        'data': {"model_id": "model_id", "data": "some_data"}
    }
    resp = ai_client.execute(command_info)
    assert isinstance(uuid.UUID(str(resp)), uuid.UUID)
    assert "pending" in ai_client.fxc.get_task(resp)


def test_process_response(ai_client):
    """
    test that we can:
     1. get the results of a hello world job
     2. the callback get executed
     3. process id is removed from the running_jobs
     4. callback function is removed from callback_info
    """

    app_uuid = uuid.uuid4()
    msg_uuid = uuid.uuid4()

    def callback_fn(x):
        return x

    funcx_uuid = fcx_cfg["test_hello_world_uuid"]
    endpoint_uuid = fcx_cfg["endpoint_uuid"]
    data = {"model_id": "model_id", "data": "some_data"}

    resp = ai_client.fxc.run(*data, function_id=funcx_uuid, endpoint_id=endpoint_uuid)
    ai_client.callback_info[resp] = (app_uuid, msg_uuid, callback_fn)
    # adding this should trigger the process_response
    ai_client.running_jobs.add(resp)

    nb_iteration = 5
    while nb_iteration > 0:
        print("inside the loop")
        if resp not in ai_client.running_jobs:
            break
        time.sleep(1)
        nb_iteration -= 1
    print("outside of the loop")
    if resp in ai_client.running_jobs:
        assert False
    elif resp in ai_client.callback_info:
        assert False
    else:
        assert True


def test_ai_client_terminates(ai_client):
    """
    Check that the ai_client terminates properly at the end of the session
    """
    ai_client.stop_thread = True
    # in case the thread is sleeping. We need to wait until it done
    time.sleep(ai_client.check_every + 1)
    assert ai_client.msg_checker.is_alive() is False


