#!/usr/bin/env python3
"""Importa as imagens do inventário para uma branch de revisão do Oratio.

Este script é o fallback server-side para casos em que o navegador bloqueia
os downloads externos por CORS. Ele nunca envia diretamente para a branch-base.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image

ALLOWED_COLLECTIONS = {
    "_oracoes": "oracoes",
    "_novenas": "novenas",
    "_quaresmas": "quaresmas",
    "_trintenas": "trintenas",
    "_devocoes_mensais": "devocoes-mensais",
    "_trezenas": "trezenas",
    "_triduos": "triduos",
    "_tercos": "tercos",
    "_rosarios": "rosarios",
    "_coroas": "coroas",
    "_devocionarios": "devocionarios",
}
ALLOWED_HOSTS = {"imcimage.weebly.com", "img.oratioapp.com.br"}
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_BYTES = 20 * 1024 * 1024


@dataclass
class Item:
    slug: str
    url: str
    target: Path | None = None
    source_md: Path | None = None
    status: str = "pending"
    detail: str = ""


def run(*args: str, cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(args), flush=True)
    return subprocess.run(args, cwd=cwd, check=check, text=True, capture_output=False)


def yaml_scalar(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*[\"']?([^\"'\r\n]+?)[\"']?\s*$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def load_csv(path: Path) -> list[Item]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "slug" not in reader.fieldnames or "Imagem" not in reader.fieldnames:
            raise RuntimeError("O CSV precisa conter as colunas slug e Imagem.")
        items: list[Item] = []
        seen: set[str] = set()
        for line, row in enumerate(reader, 2):
            slug = (row.get("slug") or "").strip()
            url = (row.get("Imagem") or "").strip()
            if not SLUG_RE.fullmatch(slug):
                raise RuntimeError(f"Slug inválido na linha {line}: {slug}")
            if slug in seen:
                raise RuntimeError(f"Slug duplicado: {slug}")
            seen.add(slug)
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
                raise RuntimeError(f"URL não autorizada para {slug}: {url}")
            items.append(Item(slug=slug, url=url))
    return items


def map_targets(repo: Path, items: list[Item]) -> None:
    by_name: dict[str, list[Path]] = {}
    for collection in ALLOWED_COLLECTIONS:
        root = repo / collection
        if not root.exists():
            continue
        for path in root.rglob("*.md"):
            by_name.setdefault(path.stem, []).append(path)

    errors: list[str] = []
    for item in items:
        candidates = by_name.get(item.slug, [])
        exact: list[tuple[Path, str]] = []
        for path in candidates:
            text = path.read_text(encoding="utf-8")
            declared_slug = yaml_scalar(text, "slug") or path.stem
            if declared_slug == item.slug:
                exact.append((path, text))
        if len(exact) != 1:
            item.status = "error"
            item.detail = "Arquivo principal ausente" if not exact else "Mais de um arquivo principal corresponde ao slug"
            errors.append(f"{item.slug}: {item.detail}")
            continue
        source, text = exact[0]
        image = yaml_scalar(text, "image")
        if image:
            rel = image.strip().lstrip("/").replace("\\", "/")
        else:
            collection = source.relative_to(repo).parts[0]
            rel = f"assets/images/{ALLOWED_COLLECTIONS[collection]}/{item.slug}.png"
            item.detail = "Destino derivado porque o front matter não possui image"
        if ".." in Path(rel).parts or not rel.startswith("assets/images/") or not rel.endswith(".png"):
            item.status = "error"
            item.detail = f"Destino inseguro ou incompatível: {rel}"
            errors.append(f"{item.slug}: {item.detail}")
            continue
        if Path(rel).name != f"{item.slug}.png":
            item.status = "error"
            item.detail = f"O caminho não usa o slug como nome: {rel}"
            errors.append(f"{item.slug}: {item.detail}")
            continue
        item.source_md = source
        item.target = repo / rel
        item.status = "mapped"
    if errors:
        raise RuntimeError("Falhas no mapeamento:\n" + "\n".join(errors))


def png_bytes(content: bytes, slug: str) -> bytes:
    if not content or len(content) > MAX_BYTES:
        raise RuntimeError(f"{slug}: tamanho de arquivo inválido")
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.load()
            if image.width <= 0 or image.height <= 0:
                raise RuntimeError("dimensões inválidas")
            if image.format == "PNG" and content.startswith(b"\x89PNG\r\n\x1a\n"):
                return content
            out = io.BytesIO()
            if image.mode not in {"RGB", "RGBA", "P", "L", "LA"}:
                image = image.convert("RGBA")
            image.save(out, format="PNG", optimize=True)
            data = out.getvalue()
            if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("a conversão não produziu PNG")
            return data
    except Exception as exc:
        raise RuntimeError(f"{slug}: conteúdo não é uma imagem válida: {exc}") from exc


def download_all(items: list[Item], allow_overwrite: bool) -> tuple[int, int, int]:
    session = requests.Session()
    session.headers.update({"User-Agent": "Oratio-Image-Importer/1.0", "Accept": "image/*"})
    new = changed = same = 0
    failures: list[str] = []
    for index, item in enumerate(items, 1):
        assert item.target is not None
        print(f"[{index}/{len(items)}] {item.slug}", flush=True)
        last_error: Exception | None = None
        response = None
        for attempt in range(1, 4):
            try:
                response = session.get(item.url, timeout=(20, 60), allow_redirects=True)
                response.raise_for_status()
                break
            except Exception as exc:
                last_error = exc
                time.sleep(attempt * 2)
        if response is None:
            failures.append(f"{item.slug}: {last_error}")
            continue
        try:
            data = png_bytes(response.content, item.slug)
            if item.target.exists():
                current = item.target.read_bytes()
                if hashlib.sha256(current).digest() == hashlib.sha256(data).digest():
                    item.status = "same"
                    same += 1
                    continue
                if not allow_overwrite:
                    failures.append(f"{item.slug}: destino existe e é diferente; substituição não autorizada")
                    continue
                changed += 1
                item.status = "changed"
            else:
                new += 1
                item.status = "new"
            item.target.parent.mkdir(parents=True, exist_ok=True)
            item.target.write_bytes(data)
        except Exception as exc:
            failures.append(str(exc))
    if failures:
        raise RuntimeError("Falhas no download/validação:\n" + "\n".join(failures))
    return new, changed, same


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--allow-overwrite", action="store_true")
    parser.add_argument("--report", type=Path, default=Path("RELATORIO_IMPORTACAO_IMAGENS.txt"))
    args = parser.parse_args()

    items = load_csv(args.csv)
    print(f"Inventário validado: {len(items)} imagens")
    map_targets(args.repo, items)
    new, changed, same = download_all(items, args.allow_overwrite)
    print(f"RESULT new={new} changed={changed} same={same}")

    report = args.report
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        "\n".join([
            f"Total no CSV: {len(items)}",
            f"Novas: {new}",
            f"Substituídas: {changed}",
            f"Idênticas: {same}",
            "",
            *[f"{x.status}\t{x.slug}\t{x.target.relative_to(args.repo) if x.target else '-'}" for x in items],
        ]) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
