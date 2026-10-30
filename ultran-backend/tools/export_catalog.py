"""Export the builtin connector catalog as JSON for the phone client.

The phone app is local-first and must list connectors with no network, so it
ships a snapshot of the catalog. The Python catalog stays the single source of
truth; run this script after editing ``connectors/catalog*.py``:

    python ultran-backend/tools/export_catalog.py          # write the snapshot
    python ultran-backend/tools/export_catalog.py --check  # fail if it is stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ultran-backend"))

from ultran_backend.connectors.catalog import BUILTIN_CONNECTORS  # noqa: E402

TARGET = ROOT / "apps" / "phone" / "src" / "connectors.catalog.json"


def render() -> str:
    rows = [
        {
            "id": m.id,
            "name": m.name,
            "category": m.category,
            "auth": m.auth_kind,
            "tier": m.tier,
            "actions": list(m.actions),
            "description": m.description,
        }
        for m in sorted(BUILTIN_CONNECTORS, key=lambda m: (m.category, m.name.lower()))
    ]
    return json.dumps(rows, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    fresh = render()
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != fresh:
            print(f"{TARGET} is stale; run tools/export_catalog.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(fresh, encoding="utf-8")
    print(f"wrote {len(BUILTIN_CONNECTORS)} connectors to {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
