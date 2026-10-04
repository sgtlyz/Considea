"""Mount ACP on the existing Render HTTP server without a second public listener."""
import asyncio
import json
import os
import threading
from urllib.parse import urlsplit

import httpx
from .app import create_app
from .gateway import Gateway
from .persistence import GatewayStore
from .catalog import ROLES


class WorkflowClient:
    """In-process equivalent of the authenticated room API; no shared service token."""
    def __init__(self, workflow):
        self.workflow = workflow

    async def aclose(self):
        pass

    async def request(self, method, path, json=None, headers=None):
        return await asyncio.to_thread(self.dispatch, method, path, json, headers or {})

    def dispatch(self, method, path, body, headers):
        from workflow.engine import WorkflowError
        w, security = self.workflow, self.workflow.security
        parts = path.strip("/").split("/")
        token = headers.get("Authorization", "").removeprefix("Bearer ")
        try:
            if method == "POST":
                security.limit("av-writes-global", 300, 60)
            if parts == ["api", "rooms"] and method == "POST":
                security.limit("create-global", 40, 86400)
                security.limit("av-create", 6, 3600)
                prepared = security.prepare(None, body.get("access_code"))
                config = dict(body.get("config") or {})
                if security.live:
                    config["max_agent_calls"] = min(config.get("max_agent_calls", security.room_limit), security.room_limit)
                    config["max_search_queries"] = min(config.get("max_search_queries", 2), 2)
                # No automatic provider retry on this externally initiated path.
                config["max_task_retries"] = 0
                result = w.create_room(body["room_context"], config, provision=security.provision(prepared))
            elif len(parts) >= 3 and parts[:2] == ["api", "rooms"]:
                room = parts[2]
                if parts[3:] == ["join"] and method == "POST":
                    result = w.join(room, body["invitation"])
                elif len(parts) == 3 and method == "GET":
                    result = w.view(token, room)
                elif parts[3:] == ["events"] and method == "POST" and body.get("room_id") == room:
                    result = w.submit(token, body)
                    if result["status"] != "accepted":
                        return httpx.Response(409, json={"error": "EVENT_REJECTED"})
                else:
                    return httpx.Response(404, json={"error": "NOT_FOUND"})
            else:
                return httpx.Response(404, json={"error": "NOT_FOUND"})
            return httpx.Response(200, json=result)
        except WorkflowError as error:
            return httpx.Response(error.status, json={"error": error.code})
        except (KeyError, TypeError, ValueError):
            return httpx.Response(400, json={"error": "INVALID_INPUT"})


class HostedACP:
    def __init__(self, workflow, seeds, *, send=None):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        self.tasks = set()
        self.gateway = None
        try:
            asyncio.run_coroutine_threadsafe(self.initialize(workflow, seeds, send), self.loop).result(20)
        except BaseException:
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(5)
            self.loop.close()
            raise

    async def initialize(self, workflow, seeds, send):
        if not isinstance(seeds, dict) or set(seeds) != set(ROLES) or any(not isinstance(s, str) or len(s) < 24 for s in seeds.values()):
            raise ValueError("Four stable private Agentverse seeds are required")
        cipher = workflow.security.cipher
        if not cipher:
            raise ValueError("Agentverse hosting requires the existing persistent CONCLAVE_SECRET_KEY")
        config = {"seeds": seeds, "workflow_url": "https://considea-dev-api.onrender.com",
                  "allow_create": os.environ.get("CONSIDEA_AGENTVERSE_ALLOW_CREATE") == "1"}
        self.gateway = Gateway(config, WorkflowClient(workflow), GatewayStore(workflow.store, cipher))
        self.app = create_app(config, self.gateway, send)

    async def handle(self, method, path, body):
        reply = self.loop.create_future()
        status, output = 500, bytearray()
        delivered = False

        async def receive():
            nonlocal delivered
            if delivered:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(event):
            nonlocal status
            if event["type"] == "http.response.start":
                status = event["status"]
            elif event["type"] == "http.response.body":
                output.extend(event.get("body", b""))
                if not event.get("more_body") and not reply.done():
                    reply.set_result((status, bytes(output)))

        async def run():
            try:
                await self.app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                    "method": method, "scheme": "https", "path": path, "raw_path": path.encode(),
                    "query_string": b"", "root_path": "", "headers": [(b"content-type", b"application/json")],
                    "server": ("localhost", 0), "client": ("127.0.0.1", 0)}, receive, send)
            except Exception:
                if not reply.done():
                    reply.set_result((500, b'{"error":"ACP_UNAVAILABLE"}'))

        task = asyncio.create_task(run())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return await asyncio.wait_for(reply, 10)

    def request(self, method, path, body=b""):
        return asyncio.run_coroutine_threadsafe(self.handle(method, path, body), self.loop).result(12)

    def close(self):
        async def shutdown():
            for task in list(self.tasks):
                task.cancel()
            await asyncio.gather(*list(self.tasks), return_exceptions=True)
            await self.gateway.close()
        asyncio.run_coroutine_threadsafe(shutdown(), self.loop).result(20)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)
        self.loop.close()


def from_environment(workflow):
    raw = os.environ.get("CONSIDEA_AGENTVERSE_SEEDS_JSON")
    return HostedACP(workflow, json.loads(raw)) if raw else None
