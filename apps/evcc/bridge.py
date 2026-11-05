# Copies evcc loadpoint mode onto the two Loxone wallboxes.
#
# Off becomes allow/off. pv, minpv, and smart become allow/on, which the
# Wallbox Manager reports as Eco (demand set, priority clear, limited by Peco).
# enable and maxcurrent are accepted and discarded, so evcc never writes amps.
# No published Loxone command sets priority, so now is applied as Eco too.

import base64
import json
import os
import ssl
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MANAGER = "1d1f24f4-0156-739a-ffff2666dbd01f1a"
WALLBOXES = {
    "inner": {
        "control": "1c25e81b-020d-5b85-ffff2666dbd01f1a",
        "node": "1d1f25f3-007d-808e-ffff25dd1733b424",
    },
    "outer": {
        "control": "1c25e82d-0148-6cbf-ffff2666dbd01f1a",
        "node": "1d1f25f3-007d-808f-ffff25dd1733b424",
    },
}
MODE_COMMAND = {
    "off": "allow/off",
    "pv": "allow/on",
    "minpv": "allow/on",
    "smart": "allow/on",
    "now": "allow/on",
}

state_lock = threading.Lock()
applied_mode = {name: None for name in WALLBOXES}
ignored_enable = {name: 0 for name in WALLBOXES}
ignored_maxcurrent = {name: [] for name in WALLBOXES}


# Reads the Loxone settings from the environment and fails if one is missing.
def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing {name}")
    return value


LOXONE_HOST = required_env("LOXONE_HOST")
LOXONE_USER = required_env("LOXONE_USER")
LOXONE_PASSWORD = required_env("LOXONE_PASSWORD")
EVCC_URL = required_env("EVCC_URL").rstrip("/")
TLS = ssl._create_unverified_context()


# Calls one Loxone control path and returns the whole LL object.
def loxone_record(path):
    token = base64.b64encode(f"{LOXONE_USER}:{LOXONE_PASSWORD}".encode()).decode()
    request = urllib.request.Request(
        f"https://{LOXONE_HOST}{path}",
        headers={"Authorization": f"Basic {token}"},
    )
    with urllib.request.urlopen(request, context=TLS, timeout=15) as response:
        body = json.loads(response.read().decode())
    record = body.get("LL", {})
    return record if isinstance(record, dict) else {}


# Calls one Loxone control path and returns the LL value.
def loxone_value(path):
    return loxone_record(path).get("value")


# Sends a wallbox command such as allow/on.
def loxone_command(control, command):
    quoted = urllib.parse.quote(command, safe="/")
    return loxone_value(f"/jdev/sps/io/{control}/{quoted}")


# Reads the manager node flags for one wallbox.
def node_flags(node):
    raw = loxone_value(f"/jdev/sps/io/{MANAGER}/getNodeValue/{node}")
    if isinstance(raw, str):
        raw = json.loads(raw)
    entry = raw.get(node, {})
    return {
        "demand": bool(entry.get("demand", False)),
        "priority": bool(entry.get("priority", False)),
        "assigned": entry.get("assigned", 0),
        "limitedBy": entry.get("limitedBy"),
    }


# Reads the wallbox block outputs. Vc is the vehicle-connected lamp the app shows.
def wallbox_outputs(control):
    record = loxone_record(f"/jdev/sps/io/{control}/all")
    outputs = {}
    for item in record.values():
        if isinstance(item, dict) and "name" in item:
            outputs[item["name"]] = item.get("value")
    return outputs


# Maps vehicle connection to the status letter evcc expects.
def status_letter(control):
    outputs = wallbox_outputs(control)
    if str(outputs.get("Cac")) == "1":
        return "C"
    if str(outputs.get("Vc")) == "1":
        return "B"
    return "A"


# Writes Off or Eco when the evcc mode changed.
def apply_mode(name, mode):
    command = MODE_COMMAND.get(mode)
    if command is None:
        raise RuntimeError(f"unknown evcc mode {mode}")
    with state_lock:
        previous = applied_mode[name]
    if previous == mode:
        return
    wallbox = WALLBOXES[name]
    loxone_command(wallbox["control"], command)
    with state_lock:
        applied_mode[name] = mode
    note = ""
    if mode == "now":
        note = " (still Eco; no priority command)"
    print(f"{name} {mode} -> {command}{note}", flush=True)


# Polls evcc and copies each loadpoint mode onto its wallbox.
def poll_evcc():
    while True:
        try:
            with urllib.request.urlopen(f"{EVCC_URL}/api/state", timeout=10) as response:
                body = json.loads(response.read().decode())
            result = body.get("result", body)
            for loadpoint in result["loadpoints"]:
                try:
                    apply_mode(loadpoint["title"], loadpoint["mode"])
                except Exception as error:
                    print(f"{loadpoint.get('title')} failed: {error}", flush=True)
        except Exception as error:
            print(f"poll failed: {error}", flush=True)
        time.sleep(2)


# HTTP endpoints evcc calls. Amp and enable writes are counted and dropped.
class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def query_value(self, key):
        parsed = urllib.parse.urlparse(self.path)
        return urllib.parse.parse_qs(parsed.query).get(key, [""])[0]

    def wallbox_name(self):
        name = urllib.parse.urlparse(self.path).path.strip("/").split("/")[0]
        if name not in WALLBOXES:
            raise KeyError(name)
        return name

    def send_text(self, status, text):
        payload = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/applied":
            with state_lock:
                snapshot = {
                    "appliedMode": dict(applied_mode),
                    "ignoredEnable": dict(ignored_enable),
                    "ignoredMaxcurrent": {name: list(values) for name, values in ignored_maxcurrent.items()},
                }
            self.send_text(200, json.dumps(snapshot))
            return
        try:
            name = self.wallbox_name()
        except KeyError:
            self.send_text(404, "unknown")
            return
        wallbox = WALLBOXES[name]
        if path.endswith("/status"):
            self.send_text(200, status_letter(wallbox["control"]))
            return
        if path.endswith("/enabled"):
            flags = node_flags(wallbox["node"])
            self.send_text(200, "true" if flags["demand"] else "false")
            return
        self.send_text(404, "unknown")

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            name = self.wallbox_name()
        except KeyError:
            self.send_text(404, "unknown")
            return
        if path.endswith("/enable"):
            with state_lock:
                ignored_enable[name] += 1
            print(f"ignored enable {name} {self.query_value('value')}", flush=True)
            self.send_text(200, "ignored")
            return
        if path.endswith("/maxcurrent"):
            value = self.query_value("value")
            with state_lock:
                ignored_maxcurrent[name].append(value)
                del ignored_maxcurrent[name][:-5]
            print(f"ignored maxcurrent {name} {value}", flush=True)
            self.send_text(200, "ignored")
            return
        self.send_text(404, "unknown")


if __name__ == "__main__":
    threading.Thread(target=poll_evcc, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    print("bridge listening on 8080", flush=True)
    server.serve_forever()
