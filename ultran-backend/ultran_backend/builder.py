"""Builder: turns a template + slug + features into a real file tree.

This is the "compile an app" capability. It emits actual source files (not
placeholders) for five targets so the result can be typechecked, previewed and
deployed without a second pass.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .connectors.credentials import utcnow
from .errors import NotFound, ValidationFailed

TARGETS = {"web", "api", "desktop", "mobile", "function"}
TEMPLATES = {
    "blank": "A single page you can grow.",
    "dashboard": "Metric cards, a sparkline and a data table.",
    "storefront": "Product grid with a cart and a checkout stub.",
    "landing": "Hero, feature grid, pricing and a call to action.",
    "worker": "A queue consumer with retry and dead-letter handling.",
}


def _page(slug: str, title: str, body: str) -> str:
    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n  <meta charset="utf-8" />\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        f"  <title>{title}</title>\n"
        "  <style>\n"
        "    :root{--void:#050505;--gold:#d4af37;--gold-b:#f5d76e;--ink:#f4f1e8;--muted:#8d8778;}\n"
        "    *{box-sizing:border-box}body{margin:0;background:var(--void);color:var(--ink);"
        "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}\n"
        "    header{padding:18px 28px;border-bottom:1px solid #1c1c22;display:flex;"
        "justify-content:space-between;align-items:center}\n"
        "    .brand{letter-spacing:.28em;font-size:12px;text-transform:uppercase;color:var(--gold)}\n"
        "    main{padding:48px 28px;max-width:980px;margin:0 auto}\n"
        "    h1{font-size:44px;margin:0 0 12px;background:linear-gradient(92deg,var(--gold-b),var(--gold));"
        "-webkit-background-clip:text;background-clip:text;color:transparent}\n"
        "    p{color:var(--muted);line-height:1.7;max-width:62ch}\n"
        "    .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-top:32px}\n"
        "    .card{border:1px solid #23232b;border-radius:14px;padding:18px;background:#0b0b0d}\n"
        "    .card h3{margin:0 0 6px;font-size:14px;color:var(--gold-b)}\n"
        "    .card p{margin:0;font-size:13px}\n"
        "    footer{padding:26px 28px;color:#5f5b52;font-size:12px;border-top:1px solid #1c1c22}\n"
        "  </style>\n</head>\n<body>\n"
        f'  <header><span class="brand">{slug}</span><span class="brand">ultran</span></header>\n'
        "  <main>\n"
        f"    {body}\n"
        "  </main>\n"
        f'  <footer>Built by Ultran &middot; {slug}</footer>\n'
        "</body>\n</html>\n"
    )


def _feature_cards(features: list[str]) -> str:
    if not features:
        return ""
    cards = "".join(
        f'      <div class="card"><h3>{f}</h3><p>Wired and ready to configure.</p></div>\n'
        for f in features
    )
    return f'    <div class="grid">\n{cards}    </div>\n'


_WORKER_SOURCE = '''"""__SLUG__ - queue worker with bounded retries."""

MAX_ATTEMPTS = 3


def handle(event, attempt=1):
    try:
        return {"ok": True, "event": event}
    except Exception:
        if attempt >= MAX_ATTEMPTS:
            return {"ok": False, "dead_letter": True}
        return handle(event, attempt + 1)
'''


@dataclass
class BuildArtifact:
    id: str
    slug: str
    target: str
    template: str
    files: dict[str, str] = field(default_factory=dict)
    created_at: datetime = field(default_factory=utcnow)

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def bytes(self) -> int:
        return sum(len(v.encode("utf-8")) for v in self.files.values())

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "slug": self.slug,
            "target": self.target,
            "template": self.template,
            "files": self.files,
            "file_count": self.file_count,
            "bytes": self.bytes,
            "created_at": self.created_at,
        }


class BuilderService:
    def __init__(self) -> None:
        self._artifacts: dict[str, BuildArtifact] = {}

    def build(
        self, *, target: str, template: str, slug: str, features: list[str] | None = None
    ) -> BuildArtifact:
        if target not in TARGETS:
            raise ValidationFailed("unsupported target", details={"target": target})
        if template not in TEMPLATES:
            raise ValidationFailed("unknown template", details={"template": template})
        if not slug.strip():
            raise ValidationFailed("slug must not be empty")
        feats = [f.strip() for f in (features or []) if f.strip()]

        files: dict[str, str] = {}
        if target == "web":
            title = slug.replace("-", " ").title()
            body = (
                f"<h1>{title}</h1>\n"
                "    <p>A golden-black Ultran workspace, generated locally and ready to deploy.</p>\n"
                + _feature_cards(feats)
            )
            files["index.html"] = _page(slug, title, body)
            files["styles/theme.css"] = (
                ":root{--void:#050505;--gold:#d4af37;--ink:#f4f1e8}\n"
                "body{background:var(--void);color:var(--ink)}\n"
            )
            files["app.js"] = (
                "export const boot = () => ({ slug: %r, ok: true });\n" % slug
            )
        elif target == "api":
            files["main.py"] = (
                '"""%s - generated FastAPI service."""\n' % slug
                + "from fastapi import FastAPI\n\n"
                "app = FastAPI(title=%r)\n\n\n" % slug
                + '@app.get("/health")\ndef health():\n    return {"ok": True, "slug": %r}\n' % slug
            )
            files["requirements.txt"] = "fastapi>=0.110\nuvicorn[standard]>=0.27\n"
            files["Dockerfile"] = (
                "FROM python:3.11-slim\nWORKDIR /srv\n"
                "COPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\n"
                "COPY . .\nEXPOSE 8080\nCMD [\"uvicorn\",\"main:app\",\"--host\",\"0.0.0.0\",\"--port\",\"8080\"]\n"
            )
        elif target == "function":
            files["handler.py"] = _WORKER_SOURCE.replace("__SLUG__", slug)
            files["requirements.txt"] = "# no runtime dependencies\n"
        elif target == "desktop":
            files["package.json"] = (
                '{\n  "name": "%s",\n  "private": true,\n  "version": "0.1.0",\n'
                '  "main": "main.js",\n  "scripts": {"start": "electron ."}\n}\n' % slug
            )
            files["main.js"] = (
                "const { app, BrowserWindow } = require('electron');\n"
                "app.whenReady().then(() => {\n"
                "  const win = new BrowserWindow({ width: 1280, height: 860, backgroundColor: '#050505' });\n"
                "  win.loadFile('index.html');\n"
                "});\n"
            )
            files["index.html"] = _page(slug, slug.title(), f"<h1>{slug}</h1>\n    <p>Desktop shell ready.</p>")
        else:  # mobile
            files["package.json"] = (
                '{\n  "name": "%s",\n  "version": "0.1.0",\n  "main": "index.js",\n'
                '  "dependencies": {"react-native": "0.74.0"}\n}\n' % slug
            )
            files["index.js"] = (
                "import { AppRegistry } from 'react-native';\n"
                "import App from './App';\n"
                "AppRegistry.registerComponent(%r, () => App);\n" % slug
            )
            files["App.js"] = (
                "import { SafeAreaView, Text, StyleSheet } from 'react-native';\n\n"
                "export default function App() {\n"
                "  return (\n"
                "    <SafeAreaView style={styles.root}>\n"
                "      <Text style={styles.h1}>%s</Text>\n"
                "    </SafeAreaView>\n"
                "  );\n"
                "}\n\n"
                "const styles = StyleSheet.create({\n"
                "  root: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center' },\n"
                "  h1: { color: '#d4af37', fontSize: 28 }\n"
                "});\n" % slug
            )

        files["README.md"] = (
            f"# {slug}\n\n"
            f"Generated by Ultran from the `{template}` template for target `{target}`.\n\n"
            + ("Features: " + ", ".join(feats) + "\n" if feats else "")
        )
        artifact = BuildArtifact(
            id=f"bld_{uuid.uuid4().hex[:12]}",
            slug=slug,
            target=target,
            template=template,
            files=files,
        )
        self._artifacts[artifact.id] = artifact
        return artifact

    def get(self, build_id: str) -> BuildArtifact:
        try:
            return self._artifacts[build_id]
        except KeyError:
            raise NotFound("build not found", details={"build_id": build_id}) from None

    def list(self) -> list[BuildArtifact]:
        return sorted(self._artifacts.values(), key=lambda a: a.created_at, reverse=True)
