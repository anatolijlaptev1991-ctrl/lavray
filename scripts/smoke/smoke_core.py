#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Живой дымовой тест lavray-core на loopback.

Запускает ядро на случайном loopback-порту с одноразовым каталогом данных, ставит
за ним крошечный локальный SOCKS5-сервер как «сервер-апстрим», подключается и
пишет, что получилось. Не трогает ничего вне каталога --out: ни системный прокси,
ни TUN, ни порт 2080 (NekoBox). Не запускается автоматически и не входит в unittest.

    python -I scripts/smoke/smoke_core.py --exe path/to/lavray-core.exe --out OUT_DIR [--mixed-port 47950]

Результат: OUT_DIR/smoke-report.json, логи ядра и runtime-config.json.
"""
import argparse
import json
import os
import secrets
import select
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

REPORT = []
SEEN = []


def log(step, value):
    REPORT.append({"step": step, "value": value})
    print(f"## {step}\n{json.dumps(value, ensure_ascii=False, indent=1)[:1500]}\n", flush=True)


class Socks5(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Socks5Handler(socketserver.BaseRequestHandler):
    def handle(self):
        c = self.request
        try:
            n = c.recv(2)[1]
            c.recv(n)
            c.sendall(b"\x05\x00")
            ver, cmd, _, atyp = c.recv(4)
            if atyp == 1:
                host = socket.inet_ntoa(c.recv(4))
            elif atyp == 3:
                host = c.recv(c.recv(1)[0]).decode()
            else:
                host = socket.inet_ntop(socket.AF_INET6, c.recv(16))
            port = int.from_bytes(c.recv(2), "big")
            SEEN.append(f"{host}:{port}")
            up = socket.create_connection((host, port), timeout=15)
            c.sendall(b"\x05\x00\x00\x01" + bytes(4) + bytes(2))
            pipe(c, up)
        except Exception as e:  # noqa: BLE001 - test helper, record and drop
            SEEN.append(f"error {e!r}")
        finally:
            c.close()


def pipe(a, b):
    socks = [a, b]
    while True:
        r, _, _ = select.select(socks, [], [], 20)
        if not r:
            return
        for s in r:
            d = s.recv(65536)
            if not d:
                return
            (b if s is a else a).sendall(d)


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Живой дымовой тест lavray-core на loopback")
    ap.add_argument("--exe", required=True, help="путь к lavray-core (.exe на Windows)")
    ap.add_argument("--out", required=True, help="каталог результатов (внутри — data/ ядра)")
    ap.add_argument("--mixed-port", type=int, default=47950, help="порт mixed-входа ядра на 127.0.0.1")
    return ap.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    out, mixed = args.out, args.mixed_port
    data = os.path.join(out, "data")
    os.makedirs(data, exist_ok=True)
    up = Socks5(("127.0.0.1", 0), Socks5Handler)
    up_port = up.server_address[1]
    threading.Thread(target=up.serve_forever, daemon=True).start()

    tok = secrets.token_urlsafe(32)
    err = open(os.path.join(out, "core-stderr.log"), "wb")
    p = subprocess.Popen([args.exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", data],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err)
    p.stdin.write((tok + "\n").encode())
    p.stdin.flush()
    t0 = time.time()
    ready = p.stdout.readline().decode().strip()
    log("ready", {"line": ready, "seconds": round(time.time() - t0, 2), "pid": p.pid})
    rest = open(os.path.join(out, "core-stdout.log"), "wb")
    threading.Thread(target=lambda: rest.write(p.stdout.read()), daemon=True).start()
    base = "http://" + ready.split()[1].replace("tcp://", "")

    def rpc(svc, method, body, timeout=90):
        req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=json.dumps(body).encode(),
                                     headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(errors="replace")[:800]

    def fetch(url, timeout=20):
        h = urllib.request.ProxyHandler({"http": f"http://127.0.0.1:{mixed}", "https": f"http://127.0.0.1:{mixed}"})
        try:
            with urllib.request.build_opener(h).open(url, timeout=timeout) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except Exception as e:  # noqa: BLE001 - record the failure mode
            return repr(e)[:200]

    def listening():
        try:
            listing = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True).stdout
        except OSError:  # нет netstat (не Windows): шаг справочный
            return []
        return [ln.split()[1] for ln in listing.splitlines() if "LISTENING" in ln and ln.split()[-1] == str(p.pid)]

    log("no-token request", urllib_status(base))
    log("status.initial", rpc("CoreService", "GetStatus", {}))
    log("settings.port", rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": str(mixed)}}}))
    st, groups = rpc("ProfileService", "ListGroups", {})
    log("groups", groups)
    gid = groups["groups"][0]["id"] if isinstance(groups, dict) and groups.get("groups") else None
    if gid is None:
        st, g = rpc("ProfileService", "CreateGroup", {"group": {"name": "smoke"}})
        log("create-group", [st, g])
        gid = g.get("id") if isinstance(g, dict) else None
    log("import", rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{up_port}#smoke-upstream", "intent": "INTENT_AS_LINKS", "targetGroupId": gid}))
    st, profiles = rpc("ProfileService", "ListProfiles", {})
    log("profiles", profiles)
    pid = profiles["profiles"][0]["id"] if isinstance(profiles, dict) and profiles.get("profiles") else None

    t0 = time.time()
    log("connect", rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_SYSTEM_PROXY"}))
    log("connect.seconds", round(time.time() - t0, 2))
    log("status.connected", rpc("CoreService", "GetStatus", {}))
    log("listening.connected", listening())
    time.sleep(3)
    for url in ["http://example.com/", "https://www.google.com/generate_204", "https://ya.ru/"]:
        log(f"fetch {url}", fetch(url))
    log("upstream saw", list(SEEN))
    st, cfg = rpc("CoreService", "GetRuntimeConfig", {})
    if isinstance(cfg, dict):
        with open(os.path.join(out, "runtime-config.json"), "w", encoding="utf-8") as f:
            f.write(cfg.get("singBoxJson", ""))
    log("runtime-config.saved", st)

    log("disconnect", rpc("CoreService", "Disconnect", {}))
    time.sleep(1)
    log("status.after-disconnect", rpc("CoreService", "GetStatus", {}))
    log("listening.after-disconnect", listening())
    log("reconnect", rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_SYSTEM_PROXY"}))
    time.sleep(3)
    log("fetch after reconnect", fetch("http://example.com/"))
    log("double-connect", rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_SYSTEM_PROXY"}))
    log("status.after-double", rpc("CoreService", "GetStatus", {}))

    t0 = time.time()
    p.stdin.close()
    try:
        p.wait(timeout=20)
        log("exit on stdin EOF", {"code": p.returncode, "seconds": round(time.time() - t0, 2)})
    except subprocess.TimeoutExpired:
        log("exit on stdin EOF", "did not exit in 20 s, killing")
        p.kill()
    up.shutdown()
    with open(os.path.join(out, "smoke-report.json"), "w", encoding="utf-8") as f:
        json.dump(REPORT, f, ensure_ascii=False, indent=1)


def urllib_status(base):
    try:
        with urllib.request.urlopen(urllib.request.Request(base + "/lavray.v1.CoreService/GetStatus", data=b"{}",
                                                           headers={"Content-Type": "application/json"}), timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


if __name__ == "__main__":
    main(sys.argv[1:])
