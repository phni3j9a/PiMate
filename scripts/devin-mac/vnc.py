#!/usr/bin/env python3
"""Drive the Devin macOS VM desktop over its RFB-over-WebSocket endpoint (forwarded by `devin-mac up`).

usage: vnc.py [--url ws://127.0.0.1:16080/] ACTION...
actions: "shot FILE" | "click X Y" | "type TEXT" | "key NAME" | "sleep SEC"
  X/Y are framebuffer pixels (the size is printed on connect).
  key names: Return space Escape BackSpace Tab Left Right Up Down
  "type" is ASCII only: the Devin VNC server turns other keysyms into the "a" key. Letters go through the
  input method, but its Return did not commit IME text; use `devin-mac key` for IME checks.
Only the "None" security type is supported (what the Devin VM offers).
Needs: websockets, pillow (devin-mac creates a venv for them).
"""

import asyncio
import struct
import sys

import websockets
from PIL import Image

KEYS = {
    "Return": 0xFF0D,
    "space": 0x20,
    "Escape": 0xFF1B,
    "BackSpace": 0xFF08,
    "Tab": 0xFF09,
    "Left": 0xFF51,
    "Up": 0xFF52,
    "Right": 0xFF53,
    "Down": 0xFF54,
}


class Conn:
    def __init__(self, ws):
        self.ws, self.buf = ws, b""

    async def read(self, n):
        while len(self.buf) < n:
            m = await self.ws.recv()
            self.buf += m if isinstance(m, bytes) else m.encode()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out


async def handshake(c):
    await c.read(12)
    await c.ws.send(b"RFB 003.008\n")
    types = list(await c.read((await c.read(1))[0]))
    if 1 not in types:
        sys.exit(f"unsupported security types {types}")
    await c.ws.send(bytes([1]))
    if struct.unpack(">I", await c.read(4))[0]:
        sys.exit("auth failed")
    await c.ws.send(bytes([1]))  # shared session
    w, h = struct.unpack(">HH", await c.read(4))
    await c.read(16)
    await c.read(struct.unpack(">I", await c.read(4))[0])
    # 32bpp little-endian true colour, raw encoding only
    await c.ws.send(struct.pack(">BxxxBBBBHHHBBBxxx", 0, 32, 24, 0, 1, 255, 255, 255, 16, 8, 0))
    await c.ws.send(struct.pack(">BxHi", 2, 1, 0))
    return w, h


async def shot(c, w, h, path):
    await c.ws.send(struct.pack(">BBHHHH", 3, 0, 0, 0, w, h))
    img = Image.new("RGB", (w, h))
    while True:
        t = (await c.read(1))[0]
        if t == 2:  # bell
            continue
        if t == 1:  # colour map: padding, first colour, count, then 6 bytes per colour
            count = struct.unpack(">xHH", await c.read(5))[1]
            await c.read(count * 6)
            continue
        if t == 3:  # server cut text
            await c.read(struct.unpack(">xxxI", await c.read(7))[0])
            continue
        if t != 0:
            sys.exit(f"unexpected message {t}")
        await c.read(1)
        for _ in range(struct.unpack(">H", await c.read(2))[0]):
            x, y, rw, rh, enc = struct.unpack(">HHHHi", await c.read(12))
            if enc != 0:
                sys.exit(f"unexpected encoding {enc}")
            data = await c.read(rw * rh * 4)
            img.paste(Image.frombuffer("RGBX", (rw, rh), data, "raw", "BGRX"), (x, y))
        break
    img.save(path)
    print("saved", path)


async def key(c, sym):
    for down in (1, 0):
        await c.ws.send(struct.pack(">BBxxI", 4, down, sym))
        await asyncio.sleep(0.04)


async def main(url, actions):
    async with websockets.connect(url, subprotocols=["binary"], max_size=None) as ws:
        c = Conn(ws)
        w, h = await handshake(c)
        print(f"framebuffer {w}x{h}")
        for a in actions:
            op, _, arg = a.partition(" ")
            if op == "shot":
                await shot(c, w, h, arg)
            elif op == "click":
                x, y = map(int, arg.split())
                for mask in (0, 1, 0):
                    await ws.send(struct.pack(">BBHH", 5, mask, x, y))
                    await asyncio.sleep(0.08)
            elif op == "type":
                for ch in arg:
                    cp = ord(ch)  # X11 keysyms: Latin-1 as is, other Unicode with the 0x01000000 prefix
                    await key(c, cp if cp <= 0xFF else 0x01000000 | cp)
            elif op == "key":
                await key(c, KEYS[arg])
            elif op == "sleep":
                await asyncio.sleep(float(arg))
            else:
                sys.exit(f"unknown action {a!r}")


if __name__ == "__main__":
    args = sys.argv[1:]
    url = "ws://127.0.0.1:16080/"
    if args[:1] == ["--url"]:
        url, args = args[1], args[2:]
    if not args:
        sys.exit(__doc__)
    asyncio.run(asyncio.wait_for(main(url, args), 120))
