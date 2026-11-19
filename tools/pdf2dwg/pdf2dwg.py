#!/usr/bin/env python3
"""
pdf2dwg.py — Convertit un PDF vectoriel en DXF, puis en DWG.

Principe
--------
1. PyMuPDF lit les tracés vectoriels de chaque page (lignes, courbes de
   Bézier, rectangles, quadrilatères) ainsi que le texte.
2. ezdxf les écrit dans un fichier DXF (format CAO ouvert).
3. Le DWG étant un format propriétaire d'Autodesk, la dernière étape
   (DXF -> DWG) passe par l'outil gratuit « ODA File Converter »
   (https://www.opendesign.com/guestfiles/oda_file_converter),
   piloté par ezdxf. Sans lui, vous obtenez quand même le DXF, qu'AutoCAD,
   BricsCAD, DraftSight, LibreCAD, etc. ouvrent directement.

Limites
-------
- Un PDF scanné (image) ne contient aucun vecteur : il faut alors
  vectoriser l'image (ex. Inkscape « Vectoriser un objet matriciel »).
- Les calques, cotes et blocs d'origine ne sont pas récupérables : le PDF
  ne contient que des traits.

Installation
------------
    pip install pymupdf ezdxf

Utilisation
-----------
    python pdf2dwg.py plan.pdf                  # -> plan.dwg (ou plan.dxf)
    python pdf2dwg.py plan.pdf -o sortie.dwg
    python pdf2dwg.py plan.pdf --dxf-only       # s'arrête au DXF
    python pdf2dwg.py plan.pdf --pages 1,3-4 --scale 1:100 --unit mm
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import ezdxf
import pymupdf
from ezdxf.addons import odafc

PT_TO_MM = 25.4 / 72  # 1 point PDF = 1/72 pouce


def parse_pages(spec: str | None, count: int) -> list[int]:
    """'1,3-5' -> [0, 2, 3, 4] (indices base 0)."""
    if not spec:
        return list(range(count))
    pages: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            pages.extend(range(int(a) - 1, int(b)))
        elif part:
            pages.append(int(part) - 1)
    return [p for p in pages if 0 <= p < count]


def parse_scale(spec: str) -> float:
    """'1:100' -> 100.0, '50' -> 50.0"""
    if ":" in spec:
        a, b = spec.split(":", 1)
        return float(b) / float(a)
    return float(spec)


def rgb_to_true_color(rgb) -> int | None:
    if not rgb:
        return None
    r, g, b = (int(round(c * 255)) for c in rgb[:3])
    if (r, g, b) in ((0, 0, 0), (255, 255, 255)):
        return None  # noir/blanc -> couleur du calque (7), lisible sur tout fond
    return ezdxf.colors.rgb2int((r, g, b))


def convert_pdf_to_dxf(
    pdf_path: Path,
    dxf_path: Path,
    pages: str | None = None,
    scale: float = 1.0,
    unit: str = "mm",
    with_text: bool = True,
    page_gap: float = 20.0,
) -> dict:
    """Écrit un DXF ; chaque page est placée à droite de la précédente."""
    doc_pdf = pymupdf.open(pdf_path)
    dxf = ezdxf.new("R2010", setup=True)
    dxf.units = {"mm": ezdxf.units.MM, "m": ezdxf.units.M, "cm": ezdxf.units.CM}.get(
        unit, ezdxf.units.MM
    )
    msp = dxf.modelspace()

    # facteur : points PDF -> unité choisie, multiplié par l'échelle du plan
    unit_factor = {"mm": 1.0, "cm": 0.1, "m": 0.001}[unit]
    k = PT_TO_MM * unit_factor * scale

    stats = {"pages": 0, "lines": 0, "curves": 0, "rects": 0, "texts": 0}
    offset_x = 0.0

    for pno in parse_pages(pages, doc_pdf.page_count):
        page = doc_pdf[pno]
        height = page.rect.height
        layer_geo = f"PAGE_{pno + 1}"
        layer_txt = f"PAGE_{pno + 1}_TEXTE"
        dxf.layers.add(layer_geo)
        dxf.layers.add(layer_txt, color=3)

        # PDF : origine en haut à gauche, Y vers le bas -> on inverse Y
        def tr(p, _h=height, _ox=offset_x):
            return (_ox + p.x * k, (_h - p.y) * k)

        for path in page.get_drawings():
            attribs = {"layer": layer_geo}
            color = rgb_to_true_color(path.get("color") or path.get("fill"))
            if color is not None:
                attribs["true_color"] = color
            width = path.get("width") or 0
            if width:
                # épaisseur DXF en 1/100 mm, valeurs autorisées limitées
                lw = int(width * PT_TO_MM * 100)
                attribs["lineweight"] = min(
                    (v for v in ezdxf.lldxf.const.VALID_DXF_LINEWEIGHTS),
                    key=lambda v: abs(v - lw),
                )

            for item in path["items"]:
                kind = item[0]
                if kind == "l":  # segment
                    msp.add_line(tr(item[1]), tr(item[2]), dxfattribs=attribs)
                    stats["lines"] += 1
                elif kind == "c":  # Bézier cubique
                    p0, c1, c2, p3 = (tr(p) for p in item[1:5])
                    _add_bezier(msp, p0, c1, c2, p3, attribs)
                    stats["curves"] += 1
                elif kind == "re":  # rectangle
                    r = item[1]
                    pts = [tr(r.tl), tr(r.tr), tr(r.br), tr(r.bl)]
                    msp.add_lwpolyline(pts, close=True, dxfattribs=attribs)
                    stats["rects"] += 1
                elif kind == "qu":  # quadrilatère
                    q = item[1]
                    pts = [tr(q.ul), tr(q.ur), tr(q.lr), tr(q.ll)]
                    msp.add_lwpolyline(pts, close=True, dxfattribs=attribs)
                    stats["rects"] += 1

        if with_text:
            for x0, y0, x1, y1, text, *_ in page.get_text("words"):
                h = (y1 - y0) * k * 0.75  # hauteur de casse approximative
                if h <= 0:
                    continue
                msp.add_text(
                    text,
                    height=h,
                    dxfattribs={"layer": layer_txt},
                ).set_placement((offset_x + x0 * k, (height - y1) * k))
                stats["texts"] += 1

        offset_x += page.rect.width * k + page_gap * unit_factor * scale
        stats["pages"] += 1

    dxf.saveas(dxf_path)
    return stats


def _add_bezier(msp, p0, c1, c2, p3, attribs):
    """Bézier cubique -> SPLINE de degré 3 exacte (4 points de contrôle)."""
    spline = msp.add_open_spline([p0, c1, c2, p3], degree=3, dxfattribs=attribs)
    return spline


def dxf_to_dwg(dxf_path: Path, dwg_path: Path, version: str = "R2018") -> bool:
    """Conversion DXF -> DWG via ODA File Converter (doit être installé)."""
    if not odafc.is_installed():
        return False
    odafc.convert(str(dxf_path), str(dwg_path), version=version, replace=True)
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Convertit un PDF vectoriel en DWG/DXF.")
    ap.add_argument("pdf", type=Path, help="fichier PDF d'entrée")
    ap.add_argument("-o", "--output", type=Path, help="fichier .dwg ou .dxf de sortie")
    ap.add_argument("--pages", help="pages à convertir, ex. 1,3-5 (défaut : toutes)")
    ap.add_argument("--scale", default="1", help="échelle du plan, ex. 1:100 (défaut 1:1)")
    ap.add_argument("--unit", choices=["mm", "cm", "m"], default="mm")
    ap.add_argument("--no-text", action="store_true", help="ignorer le texte")
    ap.add_argument("--dxf-only", action="store_true", help="ne pas convertir en DWG")
    ap.add_argument("--dwg-version", default="R2018",
                    help="R12, R2000, R2004, R2007, R2010, R2013, R2018")
    args = ap.parse_args(argv)

    if not args.pdf.is_file():
        print(f"Fichier introuvable : {args.pdf}", file=sys.stderr)
        return 1

    out = args.output or args.pdf.with_suffix(".dxf" if args.dxf_only else ".dwg")
    dxf_path = out.with_suffix(".dxf")

    stats = convert_pdf_to_dxf(
        args.pdf, dxf_path, pages=args.pages, scale=parse_scale(args.scale),
        unit=args.unit, with_text=not args.no_text,
    )
    print(f"DXF écrit : {dxf_path}  "
          f"({stats['pages']} page(s), {stats['lines']} lignes, {stats['curves']} courbes, "
          f"{stats['rects']} rectangles, {stats['texts']} textes)")
    if stats["lines"] + stats["curves"] + stats["rects"] == 0:
        print("Attention : aucun vecteur trouvé — le PDF est probablement une image scannée.",
              file=sys.stderr)

    if args.dxf_only or out.suffix.lower() == ".dxf":
        return 0

    if dxf_to_dwg(dxf_path, out, args.dwg_version):
        print(f"DWG écrit : {out}")
        return 0

    print("ODA File Converter introuvable : le DWG n'a pas été généré.\n"
          "Installez-le (https://www.opendesign.com/guestfiles/oda_file_converter) "
          "ou ouvrez directement le DXF dans votre logiciel de CAO.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
