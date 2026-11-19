#!/usr/bin/env python3
"""
raster2dxf.py — Vectorise un plan d'architecte *scanné / image* en DXF éditable.

Quand le plan d'un PDF n'est qu'une image, pdf2dwg.py ne trouve aucun trait.
Ce script :
  1. binarise l'image ;
  2. isole les murs (traits épais hachurés) -> contours fermés (LWPOLYLINE)
     + hachure, calque MURS ;
  3. squelettise le reste (portes, escaliers, équipements) -> polylignes
     simplifiées, calque MENUISERIES_DIVERS ;
  4. ignore les petits éléments isolés (lettres) : les textes sont à
     recréer en vrais TEXT (voir --labels) ;
  5. met à l'échelle à partir d'une cote connue (--px-per-m).

Usage :
    python raster2dxf.py plan.png sortie.dxf --px-per-m 43.2 [--labels labels.json]

labels.json : [{"text": "Classe 3", "x": 572, "y": 1578, "h": 22}, ...]
(coordonnées en pixels de l'image, y vers le bas, h = hauteur en pixels).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import ezdxf
import numpy as np
from skimage.morphology import skeletonize


# --------------------------------------------------------------------------- image

def binarize(img_bgr: np.ndarray, thr: int = 170) -> np.ndarray:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    return (gray < thr).astype(np.uint8)


def wall_mask(ink: np.ndarray, k_close: int = 5, k_open: int = 6) -> np.ndarray:
    """Murs = encre épaisse : on bouche les hachures puis on supprime les traits fins."""
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((k_close, k_close), np.uint8))
    walls = cv2.morphologyEx(closed, cv2.MORPH_OPEN, np.ones((k_open, k_open), np.uint8))
    # enlève les grains (points de texte gras, etc.)
    n, lab, st, _ = cv2.connectedComponentsWithStats(walls, 8)
    keep = np.zeros_like(walls)
    for i in range(1, n):
        big = max(st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]) > 32
        if st[i, cv2.CC_STAT_AREA] >= 120 and big:
            keep[lab == i] = 1
    return keep


def remove_small(mask: np.ndarray, max_side: int) -> np.ndarray:
    """Supprime les composantes dont la boîte est petite (lettres, chiffres)."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = np.zeros_like(mask)
    for i in range(1, n):
        w, h = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
        if max(w, h) > max_side:
            out[lab == i] = 1
    return out


def erase_labels(ink: np.ndarray, labels: list[dict]) -> np.ndarray:
    """Efface les lettres situées autour de chaque étiquette (petites composantes
    entièrement contenues dans la zone du texte), sans toucher aux murs."""
    ink = ink.copy()
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
    for lb in labels:
        h = lb.get("h", 20)
        half_w = 0.42 * h * len(lb["text"]) + 12
        x0, x1 = lb["x"] - half_w, lb["x"] + half_w
        y0, y1 = lb["y"] - 1.5 * h, lb["y"] + 1.5 * h
        for i in range(1, n):
            bx, by, bw, bh = st[i, :4]
            if bh < 1.6 * h and bx >= x0 and bx + bw <= x1 and by >= y0 and by + bh <= y1:
                ink[lab == i] = 0
    return ink


# --------------------------------------------------------------------- squelette

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def trace_skeleton(skel: np.ndarray) -> list[np.ndarray]:
    """Découpe un squelette 1 px en chemins entre extrémités / jonctions."""
    sk = skel.astype(bool)
    H, W = sk.shape
    pad = np.pad(sk, 1)
    deg = sum(np.roll(np.roll(pad, dy, 0), dx, 1) for dy, dx in NB)[1:-1, 1:-1] * sk
    ys, xs = np.nonzero(sk)
    visited_edges: set[tuple] = set()

    def neighbours(y, x):
        for dy, dx in NB:
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and sk[yy, xx]:
                yield yy, xx

    def is_node(y, x):
        return deg[y, x] != 2

    paths = []
    nodes = [(y, x) for y, x in zip(ys, xs) if is_node(y, x)]
    for start in nodes:
        for nxt in neighbours(*start):
            e = (start, nxt) if start < nxt else (nxt, start)
            if e in visited_edges:
                continue
            path = [start, nxt]
            visited_edges.add(e)
            prev, cur = start, nxt
            while not is_node(*cur):
                step = None
                for cand in neighbours(*cur):
                    if cand == prev:
                        continue
                    ee = (cur, cand) if cur < cand else (cand, cur)
                    if ee in visited_edges:
                        continue
                    step = cand
                    visited_edges.add(ee)
                    break
                if step is None:
                    break
                path.append(step)
                prev, cur = cur, step
            paths.append(np.array([(x, y) for y, x in path], dtype=np.float32))

    # boucles fermées sans nœud
    seen = {p for path in paths for p in map(tuple, path.astype(int))}
    for y, x in zip(ys, xs):
        if (x, y) in seen:
            continue
        loop = [(y, x)]
        seen.add((x, y))
        cur = (y, x)
        while True:
            nxt = next(((yy, xx) for yy, xx in neighbours(*cur) if (xx, yy) not in seen), None)
            if nxt is None:
                break
            loop.append(nxt)
            seen.add((nxt[1], nxt[0]))
            cur = nxt
        loop.append(loop[0])
        paths.append(np.array([(x, y) for y, x in loop], dtype=np.float32))
    return paths


def simplify(pts: np.ndarray, eps: float, closed: bool = False) -> np.ndarray:
    return cv2.approxPolyDP(pts.reshape(-1, 1, 2), eps, closed).reshape(-1, 2)


def snap_axes(pts: np.ndarray, tol_deg: float = 2.0) -> np.ndarray:
    """Redresse les segments quasi horizontaux / verticaux."""
    pts = pts.astype(np.float64).copy()
    t = np.tan(np.radians(tol_deg))
    for i in range(len(pts) - 1):
        dx, dy = pts[i + 1] - pts[i]
        if abs(dx) > 0 and abs(dy) / abs(dx) < t:
            m = (pts[i, 1] + pts[i + 1, 1]) / 2
            pts[i, 1] = pts[i + 1, 1] = m
        elif abs(dy) > 0 and abs(dx) / abs(dy) < t:
            m = (pts[i, 0] + pts[i + 1, 0]) / 2
            pts[i, 0] = pts[i + 1, 0] = m
    return pts


# ------------------------------------------------------------------------- DXF

def build_dxf(img_path: Path, out: Path, px_per_m: float, labels: list[dict],
              extra_rects: list[dict] | None = None, hatch_walls: bool = True) -> dict:
    img = cv2.imread(str(img_path))
    H = img.shape[0]
    s = 1.0 / px_per_m

    def P(x, y):
        return (round(float(x) * s, 4), round(float(H - y) * s, 4))

    ink = binarize(img)
    ink = erase_labels(ink, labels)
    walls = wall_mask(ink)
    thin = ink.copy()
    thin[cv2.dilate(walls, np.ones((5, 5), np.uint8)) > 0] = 0
    thin = remove_small(thin, max_side=28)

    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.M
    doc.header["$MEASUREMENT"] = 1
    doc.layers.add("MURS", color=7, lineweight=35)
    doc.layers.add("MURS_HACHURES", color=8)
    doc.layers.add("MENUISERIES_DIVERS", color=4, lineweight=18)
    doc.layers.add("TEXTES", color=2)
    doc.layers.add("ARMOIRES_ELEC", color=30)
    msp = doc.modelspace()
    stats = {"murs": 0, "traits": 0, "textes": 0}

    # Murs : contours extérieurs + trous (RETR_CCOMP)
    cnts, hier = cv2.findContours(walls, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    hier = hier[0] if hier is not None else []
    for i, c in enumerate(cnts):
        if hier[i][3] != -1:
            continue  # trou : traité avec son parent
        outer = snap_axes(np.vstack([simplify(c.astype(np.float32), 1.2, True)] * 1))
        boundary = [P(*p) for p in outer]
        if len(boundary) < 3:
            continue
        msp.add_lwpolyline(boundary, close=True, dxfattribs={"layer": "MURS"})
        holes = []
        ch = hier[i][2]
        while ch != -1:
            hp = snap_axes(simplify(cnts[ch].astype(np.float32), 1.2, True))
            if len(hp) >= 3 and cv2.contourArea(cnts[ch]) > 20:
                hb = [P(*p) for p in hp]
                msp.add_lwpolyline(hb, close=True, dxfattribs={"layer": "MURS"})
                holes.append(hb)
            ch = hier[ch][0]
        if hatch_walls:
            h = msp.add_hatch(dxfattribs={"layer": "MURS_HACHURES", "hatch_style": 0})
            h.set_pattern_fill("ANSI31", scale=0.02, style=0)
            h.paths.add_polyline_path(boundary, is_closed=True, flags=1)
            for hb in holes:
                h.paths.add_polyline_path(hb, is_closed=True, flags=0)
        stats["murs"] += 1

    # Traits fins : squelette -> polylignes
    skel = skeletonize(thin.astype(bool))
    for path in trace_skeleton(skel):
        if len(path) < 6:
            continue
        sp = snap_axes(simplify(path, 1.0))
        if len(sp) < 2:
            continue
        msp.add_lwpolyline([P(*p) for p in sp], dxfattribs={"layer": "MENUISERIES_DIVERS"})
        stats["traits"] += 1

    for lb in labels:
        t = msp.add_text(lb["text"], height=lb.get("h", 20) * s * 0.75,
                         dxfattribs={"layer": "TEXTES", "style": "OpenSans"})
        t.set_placement(P(lb["x"], lb["y"]), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        stats["textes"] += 1

    for r in extra_rects or []:
        x0, y0, x1, y1 = r["bbox"]
        msp.add_lwpolyline([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], close=True,
                           dxfattribs={"layer": r.get("layer", "ARMOIRES_ELEC")})
        if r.get("text"):
            t = msp.add_text(r["text"], height=(y1 - y0) * s * 0.5,
                             dxfattribs={"layer": r.get("layer", "ARMOIRES_ELEC")})
            t.set_placement(P((x0 + x1) / 2, (y0 + y1) / 2),
                            align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    doc.saveas(out)
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--px-per-m", type=float, required=True)
    ap.add_argument("--labels", type=Path)
    ap.add_argument("--no-hatch", action="store_true")
    a = ap.parse_args()
    data = json.loads(a.labels.read_text()) if a.labels else {}
    if isinstance(data, list):
        data = {"labels": data}
    st = build_dxf(a.image, a.output, a.px_per_m, data.get("labels", []),
                   data.get("rects"), not a.no_hatch)
    print(a.output, st)


if __name__ == "__main__":
    main()
