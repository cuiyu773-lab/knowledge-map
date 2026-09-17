#!/usr/bin/env python3
"""将 PPTX 幻灯片中的 WMF/EMF 预览对象渲染为高清 PNG。"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageOps


SCHEMA_VERSION = 1
HELPER_VERSION = "1.0.0"
RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
IMAGE_EXTENSIONS = {".wmf", ".emf"}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def slide_number(slide_path: str) -> int:
    match = re.search(r"/slide(\d+)\.xml$", slide_path)
    return int(match.group(1)) if match else 0


def relationship_path(slide_path: str) -> str:
    directory, filename = posixpath.split(slide_path)
    return posixpath.join(directory, "_rels", f"{filename}.rels")


def read_slide_relationships(archive: zipfile.ZipFile, slide_path: str) -> dict[str, str]:
    rel_path = relationship_path(slide_path)
    if rel_path not in archive.namelist():
        return {}

    root = ET.fromstring(archive.read(rel_path))
    base_directory = posixpath.dirname(slide_path)
    relationships: dict[str, str] = {}
    for node in root:
        relationship_id = node.attrib.get("Id")
        target = node.attrib.get("Target")
        if not relationship_id or not target or node.attrib.get("TargetMode") == "External":
            continue
        normalized = posixpath.normpath(posixpath.join(base_directory, target))
        if Path(normalized).suffix.lower() in IMAGE_EXTENSIONS:
            relationships[relationship_id] = normalized
    return relationships


def referenced_relationship_ids(slide_xml: bytes, available: dict[str, str]) -> list[str]:
    root = ET.fromstring(slide_xml)
    embed_attribute = f"{{{RELATIONSHIP_NS}}}embed"
    id_attribute = f"{{{RELATIONSHIP_NS}}}id"
    result: list[str] = []
    seen: set[str] = set()

    for node in root.iter():
        for attribute in (embed_attribute, id_attribute):
            relationship_id = node.attrib.get(attribute)
            if relationship_id in available and relationship_id not in seen:
                seen.add(relationship_id)
                result.append(relationship_id)
    return result


def target_dpi_for_size(
    source_size: tuple[int, int],
    source_dpi: tuple[float, float],
    requested_dpi: int,
    max_side: int,
    max_pixels: int,
) -> float:
    width, height = source_size
    x_dpi, y_dpi = source_dpi
    if width <= 0 or height <= 0 or x_dpi <= 0 or y_dpi <= 0:
        return float(requested_dpi)

    scale = requested_dpi / max(x_dpi, y_dpi)
    if max(width, height) * scale > max_side:
        scale = min(scale, max_side / max(width, height))
    if width * height * scale * scale > max_pixels:
        scale = min(scale, math.sqrt(max_pixels / (width * height)))
    return max(1.0, max(x_dpi, y_dpi) * scale)


def render_metafile(
    data: bytes,
    output_path: Path,
    requested_dpi: int,
    max_side: int,
    max_pixels: int,
) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as source:
        raw_dpi = source.info.get("dpi", 72)
        source_dpi = (float(raw_dpi), float(raw_dpi)) if isinstance(raw_dpi, (int, float)) else (
            float(raw_dpi[0]),
            float(raw_dpi[1]),
        )
        render_dpi = target_dpi_for_size(source.size, source_dpi, requested_dpi, max_side, max_pixels)
        source.load(dpi=render_dpi)
        image = source.convert("RGB")

        if max(image.size) > max_side or image.width * image.height > max_pixels:
            image = ImageOps.contain(image, (max_side, max_side), Image.Resampling.LANCZOS)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path, "PNG", dpi=(render_dpi, render_dpi), optimize=True)
        return image.size


def write_json_atomic(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def render_pptx(
    input_path: Path,
    output_directory: Path,
    requested_dpi: int,
    max_side: int,
    max_pixels: int,
    source_hash: str,
) -> dict[str, object]:
    output_directory.mkdir(parents=True, exist_ok=True)
    objects: list[dict[str, object]] = []
    warnings: list[str] = []

    with zipfile.ZipFile(input_path) as archive:
        slides = sorted(
            (
                name
                for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ),
            key=slide_number,
        )
        if not slides:
            raise ValueError("PPTX 中没有找到幻灯片")

        for slide_path in slides:
            number = slide_number(slide_path)
            relationships = read_slide_relationships(archive, slide_path)
            relationship_ids = referenced_relationship_ids(archive.read(slide_path), relationships)
            for ordinal, relationship_id in enumerate(relationship_ids, start=1):
                media_path = relationships[relationship_id]
                object_id = f"slide-{number:03d}-object-{ordinal:03d}"
                extension = Path(media_path).suffix.lower()
                source_name = f"{object_id}{extension}"
                png_name = f"{object_id}.png"
                source_path = output_directory / source_name
                png_path = output_directory / png_name
                record: dict[str, object] = {
                    "id": object_id,
                    "slideNumber": number,
                    "relationshipId": relationship_id,
                    "sourceMediaPath": media_path,
                    "sourceKind": extension.removeprefix("."),
                    "sourceFile": source_name,
                    "pngFile": png_name,
                    "sourceSha256": "",
                    "pngSha256": "",
                    "width": 0,
                    "height": 0,
                }
                try:
                    blob = archive.read(media_path)
                    source_path.write_bytes(blob)
                    record["sourceSha256"] = sha256_bytes(blob)
                    width, height = render_metafile(
                        blob, png_path, requested_dpi, max_side, max_pixels
                    )
                    record["width"] = width
                    record["height"] = height
                    record["pngSha256"] = sha256_bytes(png_path.read_bytes())
                except Exception as error:  # 单个对象失败不能阻断其余幻灯片
                    message = f"{object_id}: {type(error).__name__}: {error}"
                    warnings.append(message)
                    record["error"] = str(error)[:300]
                objects.append(record)

    manifest: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "helperVersion": HELPER_VERSION,
        "sourceHash": source_hash,
        "sourceName": input_path.name,
        "slideCount": len(slides),
        "requestedDpi": requested_dpi,
        "maxSide": max_side,
        "maxPixels": max_pixels,
        "objects": objects,
        "warnings": warnings,
    }
    write_json_atomic(output_directory / "manifest.json", manifest)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="将 PPTX 中的 WMF/EMF 渲染为 PNG")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--dpi", type=int, default=576)
    parser.add_argument("--max-side", type=int, default=4096)
    parser.add_argument("--max-pixels", type=int, default=16_000_000)
    parser.add_argument("--source-hash", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = render_pptx(
            args.input, args.output, args.dpi, args.max_side, args.max_pixels, args.source_hash
        )
        print(json.dumps({"ok": True, "objectCount": len(manifest["objects"])}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())