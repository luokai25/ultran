"""Module entry point: python -m ultron_backend."""

from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    uvicorn.run(
        "ultron_backend.app:app",
        host=os.environ.get("ULTRON_HOST", "127.0.0.1"),
        port=int(os.environ.get("ULTRON_PORT", "8080")),
        reload=os.environ.get("ULTRON_DEBUG", "").lower() in {"1", "true", "yes"},
    )


if __name__ == "__main__":
    main()
