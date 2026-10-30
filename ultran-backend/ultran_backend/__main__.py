"""Module entry point: python -m ultran_backend."""

from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    uvicorn.run(
        "ultran_backend.app:app",
        host=os.environ.get("ULTRAN_HOST", "127.0.0.1"),
        port=int(os.environ.get("ULTRAN_PORT", "8080")),
        reload=os.environ.get("ULTRAN_DEBUG", "").lower() in {"1", "true", "yes"},
    )


if __name__ == "__main__":
    main()
