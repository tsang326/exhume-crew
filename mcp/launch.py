#!/usr/bin/env python3
"""Launcher for the Exhume Crew MCP servers. Standard library only.

Usage: python3 mcp/launch.py exhume | catalogue
Never imports kiro_crew; derives the app folder from its own location.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
DATA = os.path.join(ROOT, "data")


def fail(msg, code=1):
    sys.stderr.write(msg + "\n")
    sys.exit(code)


def version_key(path):
    m = re.search(r"/v?(\d+)\.(\d+)\.(\d+)/", path)
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def find_node():
    found = shutil.which("node")
    if found:
        return found
    home = os.path.expanduser("~")
    nvm = glob.glob(os.path.join(home, ".nvm", "versions", "node", "*", "bin", "node"))
    for cand in sorted(nvm, key=version_key, reverse=True) + [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
    ]:
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def node_major(node):
    try:
        out = subprocess.run(
            [node, "-p", "process.versions.node.split('.')[0]"],
            capture_output=True, text=True, timeout=15,
        ).stdout.strip()
        return int(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def library_path():
    try:
        with open(os.path.join(DATA, "library-active.json"), encoding="utf-8") as f:
            path = json.load(f).get("path")
    except (OSError, ValueError, AttributeError):
        return None
    if isinstance(path, str) and os.path.isdir(path):
        return path
    return None


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else None
    if mode not in ("exhume", "catalogue"):
        fail("Unknown mode. Use: launch.py exhume | catalogue", 2)
    node = find_node()
    if not node:
        fail("Node.js not found. Install Node.js 22 or newer.")
    if node_major(node) < 22:
        fail("Node.js 22 or newer is required.")
    if mode == "exhume":
        lib = library_path()
        if not lib:
            fail("No library selected. Open Exhume Crew and choose a library folder.")
        script = os.path.join(ROOT, "mcp", "exhume-mcp.mjs")
        args = [node, script, "--root", lib]
    else:
        script = os.path.join(ROOT, "mcp", "catalogue-mcp.mjs")
        args = [node, script, "--data-dir", DATA]
    os.execv(node, args)


if __name__ == "__main__":
    main()
