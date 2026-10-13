#!/usr/bin/env python3
"""PoC用: PCからの abduco Attach を疑似端末で再現し、キー入力→Detachする。

使い方: attach_drive.py <session> [--keys TEXT]... [--wait SEC] [--out FILE]
  --keys の文字列は Enter を "\\r" で表す。最後に Ctrl-\\ (abducoのdetachキー) を送る。
画面出力は --out にそのまま保存する（ANSIを含む）。
"""
import argparse, os, pty, select, signal, struct, fcntl, termios, time, sys

ap = argparse.ArgumentParser()
ap.add_argument("session")
ap.add_argument("--keys", action="append", default=[])
ap.add_argument("--wait", type=float, default=2.0)
ap.add_argument("--out", default=None)
ap.add_argument("--abduco", default="abduco")
a = ap.parse_args()

pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execvp(a.abduco, [a.abduco, "-a", a.session])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
out = bytearray()

def pump(sec):
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                out.extend(os.read(fd, 65536))
            except OSError:
                return False
    return True

pump(a.wait)
for k in a.keys:
    os.write(fd, k.encode().decode("unicode_escape").encode())
    pump(a.wait)
os.write(fd, b"\x1c")  # Ctrl-\ = detach
pump(1.0)
try:
    wpid, status = os.waitpid(pid, os.WNOHANG)
except ChildProcessError:
    wpid, status = pid, 0
if a.out:
    open(a.out, "wb").write(out)
print(f"attached_bytes={len(out)} client_exited={wpid == pid}")
