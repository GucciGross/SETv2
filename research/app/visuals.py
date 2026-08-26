"""Report visuals: server-side chart rendering + source-image handling.

The synthesis crew emits chart specs as fenced blocks:

    ```set:chart
    {"type": "bar", "title": "...", "x": [...], "series": {"name": [...]}}
    ```

persist() renders each spec to a PNG (matplotlib, SET-dark palette) under
DATA_DIR/research-assets/<run_id>/ and swaps the fence for markdown image
syntax pointing at the Node asset route. Source images (og:image / figures)
are downloaded alongside and referenced in a gallery section.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from pathlib import Path

import httpx

PALETTE = ["#6c8cff", "#8ce0ff", "#b58cff", "#7de0a8", "#ffd479", "#ff8c9c"]
BG = "#0e1220"
GRID = "#232a3f"
TEXT = "#d7deef"

CHART_FENCE = re.compile(r"```set:chart\s*\n(.*?)```", re.S)


def assets_dir(data_dir: str, run_id: str) -> Path:
    d = Path(data_dir) / "research-assets" / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _style_axes(ax) -> None:
    ax.set_facecolor(BG)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("bottom", "left"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=TEXT, labelsize=9)
    ax.title.set_color(TEXT)
    ax.grid(True, color=GRID, linewidth=0.6, alpha=0.8)
    ax.xaxis.label.set_color(TEXT)
    ax.yaxis.label.set_color(TEXT)


def render_chart(spec: dict, out_path: Path) -> bool:
    """bar | line | area | pie from a small spec; False when unusable."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ctype = spec.get("type", "bar")
    xs = spec.get("x") or []
    series = spec.get("series") or {}
    if not xs or not series:
        return False
    try:
        fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
        fig.patch.set_facecolor(BG)
        _style_axes(ax)
        colors = iter(PALETTE)
        if ctype == "pie":
            first = list(series.values())[0]
            wedges, _, autotexts = ax.pie(
                first, labels=xs, colors=PALETTE[: len(xs)],
                autopct="%1.0f%%", textprops={"color": TEXT, "fontsize": 9},
            )
            for t in autotexts:
                t.set_color("#0e1220")
            ax.set_facecolor(BG)
        else:
            for name, ys in series.items():
                if len(ys) != len(xs):
                    ys = (ys + [0] * len(xs))[: len(xs)]
                c = next(colors)
                if ctype == "line":
                    ax.plot(range(len(xs)), ys, label=name, color=c, linewidth=2, marker="o", markersize=3.5)
                elif ctype == "area":
                    ax.fill_between(range(len(xs)), ys, alpha=0.35, color=c)
                    ax.plot(range(len(xs)), ys, color=c, linewidth=1.6, label=name)
                else:  # bar
                    width = 0.8 / max(len(series), 1)
                    off = list(series).index(name) * width
                    ax.bar([i + off for i in range(len(xs))], ys, width=width, label=name, color=c)
            ax.set_xticks(range(len(xs)))
            ax.set_xticklabels([str(x)[:18] for x in xs], rotation=20 if len(str(xs[0])) > 6 else 0, ha="right" if len(str(xs[0])) > 6 else "center")
        if spec.get("title"):
            ax.set_title(str(spec["title"])[:80], fontsize=11, pad=10)
        if ctype != "pie" and len(series) > 1:
            leg = ax.legend(facecolor=BG, edgecolor=GRID, labelcolor=TEXT, fontsize=8)
            if leg:
                leg.get_frame().set_alpha(0.9)
        fig.tight_layout()
        fig.savefig(out_path, facecolor=BG)
        plt.close(fig)
        return True
    except Exception:
        plt.close("all")
        return False


def render_fences(report_md: str, data_dir: str, run_id: str, base_url: str) -> str:
    """Swap ```set:chart fences for rendered PNGs referenced by URL."""
    out = report_md

    def repl(m: re.Match) -> str:
        try:
            spec = json.loads(m.group(1))
        except Exception:
            return m.group(0)  # leave malformed fences for the editor to show
        for i in range(1, 99):
            out_path = assets_dir(data_dir, run_id) / f"chart-{i}.png"
            if out_path.exists():
                continue
            if render_chart(spec, out_path):
                # relative URL: resolves against whatever origin the user browses
                url = f"/api/research/{run_id}/assets/chart-{i}.png"
                cap = f"*Figure: {spec.get('title') or spec.get('type', 'chart')}*"
                return f"![chart]({url})\n\n{cap}"
            return m.group(0)
        return m.group(0)

    return CHART_FENCE.sub(repl, out)


def download_image(url: str, dest: Path) -> bool:
    try:
        with httpx.Client(timeout=20, follow_redirects=True, headers={"user-agent": "SET-Research/1.0"}) as c:
            r = c.get(url)
        if r.status_code != 200 or not (100 < len(r.content) <= 8_000_000):
            return False
        ctype = r.headers.get("content-type", "")
        if not (ctype.startswith("image/") or url.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))):
            return False
        ext = ".png" if "png" in ctype else ".jpg"
        dest.with_suffix(ext).write_bytes(r.content)
        return True
    except Exception:
        return False


def build_gallery(images: list[dict], data_dir: str, run_id: str, base_url: str, max_images: int = 6) -> str:
    """Download the best source images, return a markdown gallery section."""
    lines = ["", "## Pictures from sources", ""]
    saved = 0
    seen: set[str] = set()
    for img in images:
        if saved >= max_images:
            break
        url = img.get("url") or ""
        if not url.startswith("http") or url in seen:
            continue
        seen.add(url)
        dest = assets_dir(data_dir, run_id) / f"img-{saved + 1}"
        if download_image(url, dest):
            actual = dest.with_suffix(".png") if dest.with_suffix(".png").exists() else dest.with_suffix(".jpg")
            if not actual.exists() or actual.stat().st_size < 100:
                continue
            name = actual.name
            label = urllib.parse.quote((img.get("title") or "source image")[:80])
            src = img.get("source_url") or ""
            src_md = f" (from [{urllib.parse.quote(img.get('source_title') or 'source', safe='')}]({src}))" if src else ""
            lines.append(f"![{label}](/api/research/{run_id}/assets/{name}){src_md}")
            lines.append("")
            saved += 1
    return "\n".join(lines) if saved else ""
