from __future__ import annotations

import sys

from ..config import Settings
from ..container import Container
from .server import build_server

USAGE = (
    "usage: python -m ultran_backend.mcp\n\n"
    "Serves Ultran's read-only tools over MCP on stdio.\n"
    "Configure it in your MCP host as a stdio server.\n"
)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in {"-h", "--help"}:
        # stderr: stdout is the JSON-RPC channel and must stay clean.
        print(USAGE, file=sys.stderr)
        return 0

    container = Container.build(Settings.from_env())
    server = build_server(container)
    try:
        server.serve_stdio()
    except KeyboardInterrupt:  # pragma: no cover - interactive
        return 130
    finally:
        container.close()
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main())
