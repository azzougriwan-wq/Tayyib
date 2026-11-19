#!/usr/bin/env python3
"""
Plans R+1 / R+2 « Brasseurs d'air – amiante » (PDF vectoriels) -> DXF à l'échelle réelle.

- Le fond de plan (traits noirs du PDF, issus d'un DAO) est importé tel quel,
  mis à l'échelle (≈ 14,13 pt/m, calé sur les cotes des grandes salles).
- Les COTES INSCRITES sur le plan font foi : chaque pièce cotée reçoit un
  contour intérieur aux dimensions inscrites (centré sur la pièce dessinée)
  et de vraies cotes AutoCAD qui mesurent ce contour.
- Zone amiante (bande rouge raster) vectorisée, point de prélèvement, TE,
  légende et écarts dessin / cotes inscrites en notes.

Usage : python plans_amiante.py plan.pdf sortie.dxf "R+1"
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import cv2
import ezdxf
import numpy as np
import pymupdf
from ezdxf.enums import TextEntityAlignment

PT_PER_M = 14.13       # calage sur 101/104/106/115/201/203/204/208
X0, Y0 = 100.0, 760.0  # origine (pt) -> le dessin reste en coordonnées positives
BLACK = (0.0, 0.0, 0.0)
RED_COTE = (0.84, 0.1, 0.11)


def M(x, y):
    return (round((x - X0) / PT_PER_M, 4), round((Y0 - y) / PT_PER_M, 4))


def rgb(c):
    return tuple(round(v, 2) for v in (c or ()))


# ------------------------------------------------------------------ document

def new_doc():
    doc = ezdxf.new("R2010", setup=False)
    doc.units = ezdxf.units.M
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$DIMDSEP"] = ord(",")
    doc.styles.new("ARIAL", dxfattribs={"font": "arial.ttf"})
    for name, color, lw in [("PLAN_EXISTANT", 7, 18), ("CARTOUCHE", 8, 13),
                            ("PIECES_COTES_INSCRITES", 5, 35), ("COTES", 1, 13),
                            ("TEXTES", 2, 18), ("AMIANTE_ZONE", 1, 25),
                            ("AMIANTE_PRELEVEMENT", 3, 25), ("ELEC_TE", 6, 25),
                            ("NOTES", 7, 13)]:
        doc.layers.add(name, color=color, lineweight=lw)
    ds = doc.dimstyles.new("COTES_M")
    for k, v in dict(dimtxsty="ARIAL", dimtxt=0.22, dimasz=0.15, dimblk="ARCHTICK",
                     dimexe=0.08, dimexo=0.05, dimgap=0.05, dimdec=2, dimdsep=ord(","),
                     dimlunit=2, dimzin=0, dimtad=1, dimpost="<> m",
                     dimclrd=1, dimclre=1, dimclrt=1).items():
        ds.dxf.set(k, v)
    doc.header["$DIMSTYLE"] = "COTES_M"
    doc.header["$TEXTSTYLE"] = "ARIAL"
    return doc


def text(msp, s, x, y, h, layer="TEXTES", align=TextEntityAlignment.MIDDLE_CENTER):
    t = msp.add_text(s, height=h, dxfattribs={"layer": layer, "style": "ARIAL"})
    t.set_placement((x, y), align=align)
    return t


# ------------------------------------------------------------------ mesures

def room_faces(page, ink, S, label_xy):
    """Nus intérieurs (pt) d'une pièce par lancer de rayons depuis l'étiquette."""
    cx, cy = label_xy

    def ray(dx, dy, ox, oy):
        x, y = int((cx + ox) * S), int((cy + oy) * S)
        while not ink[y, x]:
            x += dx
            y += dy
        return x / S if dx else y / S

    xl = np.median([ray(-1, 0, 0, o) for o in range(-25, 26, 5)])
    xr = np.median([ray(1, 0, 0, o) for o in range(-25, 26, 5)])
    yt = np.median([ray(0, -1, o, 0) for o in range(-40, 41, 5)])
    yb = np.median([ray(0, 1, o, 0) for o in range(-40, 41, 5)])
    return xl, xr, yt, yb


def black_raster(page, dpi=600):
    out = pymupdf.open()
    q = out.new_page(width=page.rect.width, height=page.rect.height)
    sh = q.new_shape()
    for dr in page.get_drawings():
        if rgb(dr.get("color")) == BLACK:
            for it in dr["items"]:
                if it[0] == "l":
                    sh.draw_line(it[1], it[2])
                elif it[0] == "c":
                    sh.draw_bezier(*it[1:5])
                elif it[0] == "re":
                    sh.draw_rect(it[1])
                elif it[0] == "qu":
                    sh.draw_quad(it[1])
            sh.finish(color=(0, 0, 0), width=dr.get("width") or 0.5)
    sh.commit()
    pix = q.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    return a < 128, dpi / 72


# ------------------------------------------------------------------ export

def is_cartouche(r):
    return r.width > 400 or (r.x1 < 150 and r.y0 > 470) or (270 < r.x0 and r.x1 < 350 and r.y0 > 435 and r.y1 < 560)


def convert(pdf: Path, out: Path, etage: str) -> list[str]:
    pdoc = pymupdf.open(pdf)
    page = pdoc[0]
    doc = new_doc()
    msp = doc.modelspace()

    # 1) fond de plan vectoriel (traits noirs)
    for dr in page.get_drawings():
        if rgb(dr.get("color")) != BLACK or dr["rect"].x0 > 432 and dr["rect"].y0 > 390:
            continue
        layer = "CARTOUCHE" if is_cartouche(dr["rect"]) else "PLAN_EXISTANT"
        at = {"layer": layer}
        for it in dr["items"]:
            k = it[0]
            if k == "l":
                msp.add_line(M(it[1].x, it[1].y), M(it[2].x, it[2].y), dxfattribs=at)
            elif k == "c":
                msp.add_open_spline([M(p.x, p.y) for p in it[1:5]], degree=3, dxfattribs=at)
            elif k == "re":
                r = it[1]
                msp.add_lwpolyline([M(r.x0, r.y0), M(r.x1, r.y0), M(r.x1, r.y1), M(r.x0, r.y1)],
                                   close=True, dxfattribs=at)
            elif k == "qu":
                q = it[1]
                msp.add_lwpolyline([M(q.ul.x, q.ul.y), M(q.ur.x, q.ur.y), M(q.lr.x, q.lr.y),
                                    M(q.ll.x, q.ll.y)], close=True, dxfattribs=at)

    # 2) tableau des cotes inscrites
    blocks = page.get_text("blocks")
    tb = next(b for b in blocks if b[4].startswith("Pièce\nCotes"))[4].split("\n")[2:]
    cotes = {tb[i]: tuple(float(v.replace(",", ".")) for v in tb[i + 1].replace(" ", "").split("×"))
             for i in range(0, len(tb) - 1, 2) if tb[i]}

    ink, S = black_raster(page)
    ecarts = []
    for b in blocks:
        lines = b[4].strip().split("\n")
        if b[0] > 436 or lines[0] not in cotes:
            continue
        num, nom = lines[0], (lines[1] if len(lines) > 1 else "")
        l_vert, l_horiz = cotes[num]          # « l × L » : l = vertical, L = horizontal (cf. plan)
        lab = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        xl, xr, yt, yb = room_faces(page, ink, S, lab)
        dw, dh = (xr - xl) / PT_PER_M, (yb - yt) / PT_PER_M
        cx, cy = M((xl + xr) / 2, (yt + yb) / 2)
        x0, x1 = cx - l_horiz / 2, cx + l_horiz / 2
        y0, y1 = cy - l_vert / 2, cy + l_vert / 2
        msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True,
                           dxfattribs={"layer": "PIECES_COTES_INSCRITES"})
        d = msp.add_linear_dim(base=(cx, y1 - 0.6), p1=(x0, y1), p2=(x1, y1), dimstyle="COTES_M",
                               dxfattribs={"layer": "COTES"})
        d.render()
        d = msp.add_linear_dim(base=(x1 - 0.6, cy), p1=(x1, y0), p2=(x1, y1), angle=90,
                               dimstyle="COTES_M", dxfattribs={"layer": "COTES"})
        d.render()
        text(msp, num, cx, cy + 0.35, 0.45)
        text(msp, nom, cx, cy - 0.2, 0.22)
        text(msp, f"{l_vert:.2f} × {l_horiz:.2f} m – S = {l_vert * l_horiz:.2f} m²".replace(".", ","),
             cx, cy - 0.6, 0.18)
        e = max(abs(dw - l_horiz), abs(dh - l_vert))
        ecarts.append(f"{num} : inscrit {l_vert:.2f} × {l_horiz:.2f} – dessin {dh:.2f} × {dw:.2f}"
                      .replace(".", ",") + (f"  (écart {e:.2f} m)".replace(".", ",") if e >= 0.05 else ""))

    # 3) zone amiante (image masquée -> contour vectoriel)
    for im in page.get_images(full=True):
        if im[2] > 600 or not im[1]:
            continue
        bbox = next(i["bbox"] for i in page.get_image_info(xrefs=True) if i["xref"] == im[0])
        m = pymupdf.Pixmap(pdoc, im[1])
        a = np.frombuffer(m.samples, np.uint8).reshape(m.height, m.width)
        mask = (a > 127).astype(np.uint8)
        sx, sy = (bbox[2] - bbox[0]) / m.width, (bbox[3] - bbox[1]) / m.height
        cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        h = msp.add_hatch(color=1, dxfattribs={"layer": "AMIANTE_ZONE"})
        h.set_pattern_fill("ANSI37", scale=0.01, style=0)
        for c, hh in zip(cnts, hier[0]):
            if cv2.contourArea(c) < 30:
                continue
            ap = cv2.approxPolyDP(c, 1.0, True).reshape(-1, 2)
            pts = [M(bbox[0] + (x + 0.5) * sx, bbox[1] + (y + 0.5) * sy) for x, y in ap]
            msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "AMIANTE_ZONE"})
            h.paths.add_polyline_path(pts, is_closed=True, flags=1 if hh[3] == -1 else 0)

    # 4) point de prélèvement, TE, annotations
    for dr in page.get_drawings():
        r, f = dr["rect"], rgb(dr.get("fill"))
        if r.x0 > 432:
            continue
        if dr["items"][0][0] == "c" and f in ((0.08, 0.5, 0.24), (0.82, 0.0, 0.0)):
            msp.add_circle(M(*r.tl + (r.br - r.tl) / 2), r.width / 2 / PT_PER_M,
                           dxfattribs={"layer": "AMIANTE_PRELEVEMENT"})
        elif f == (0.76, 0.09, 0.36):
            msp.add_lwpolyline([M(r.x0, r.y0), M(r.x1, r.y0), M(r.x1, r.y1), M(r.x0, r.y1)],
                               close=True, dxfattribs={"layer": "ELEC_TE"})
    for w in page.get_text("blocks"):
        s = w[4].strip()
        if w[2] < 432 and re.fullmatch(r"P\d{4}", s):
            text(msp, s, *M((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), 0.35, "AMIANTE_PRELEVEMENT")
        elif w[2] < 432 and s.startswith("TE R"):
            text(msp, s, *M((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), 0.35, "ELEC_TE")

    # 5) notes (légende du PDF + écarts)
    nx, ny = M(445, 400)
    notes = [f"École maternelle – {etage} – brasseurs d'air / amiante",
             "Unités : mètre – échelle 1:1 – cotes intérieures inscrites sur le plan d'origine",
             "Calque PIECES_COTES_INSCRITES : contours aux cotes inscrites (font foi)",
             "Calque PLAN_EXISTANT : fond de plan d'origine (DAO), mis à l'échelle",
             "", "Cotes inscrites (l × L) / mesurées sur le fond de plan :"] + ecarts
    for b in blocks:
        if b[0] > 436 and b[1] > 510:
            notes += [""] + [ln for ln in b[4].strip().split("\n")]
    for i, ln in enumerate(notes):
        text(msp, ln, nx, ny - i * 0.42, 0.25, "NOTES", TextEntityAlignment.LEFT)

    doc.saveas(out)
    return ecarts


if __name__ == "__main__":
    for e in convert(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]):
        print(e)
