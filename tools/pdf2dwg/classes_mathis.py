#!/usr/bin/env python3
"""
Classes 3 à 7 — École élémentaire 14 rue Mathis (R+1).

Redessin propre, à l'échelle 1:1 en mètres, d'après le plan coté (indice B) :
  - cotes intérieures 7,33 x 6,80 m (valeurs basses du tableau, cohérentes
    avec le plan au 1/100) ;
  - murs, portes et placards relevés sur le plan au 1/100
    (64,67 px/m, précision ±2 cm) ;
  - vraies cotes AutoCAD (DIMENSION), hauteurs et surface en texte.

Sortie : un DXF par classe + un DXF d'ensemble (à convertir en DWG avec dxf2dwg.mjs).
"""

from __future__ import annotations

import sys
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

W, D = 7.33, 6.80          # largeur / profondeur intérieures (m)
T_CLOISON = 0.28           # cloisons entre classes et mur couloir (relevé)
T_FACADE = 0.26            # mur de façade (relevé)
K = 7.33 / 474             # m par pixel du plan au 1/100 (474 px = 7,33 m)
PAS = W + T_CLOISON        # entraxe des classes

def px(v: float) -> float:
    return round(v * K, 2)

# Données relevées (pixels, à partir du nu intérieur gauche de chaque classe)
CLASSES = [
    dict(num=3, salle="CE1 A", hsfp="2,58", hsp="≈ 2,70", plafond="faux plafond fixe",
         porte_couloir=(93, 149), placards=[(2, 77), (403, 472)],
         porte_g=dict(battant="dehors"), porte_d=dict(battant="dedans")),
    dict(num=4, salle="CE1 B", hsfp="2,59", hsp="≈ 2,70", plafond="faux plafond fixe",
         porte_couloir=(93, 149), placards=[(2, 73), (403, 472)],
         porte_g=dict(battant="dehors"), porte_d=dict(battant="dedans")),
    dict(num=5, salle="CM2 B", hsfp="2,60", hsp="≈ 2,70", plafond="faux plafond fixe",
         porte_couloir=(92, 147), placards=[],
         porte_g=dict(battant="dehors"), porte_d=None),
    dict(num=6, salle="CP B", hsfp="2,71", hsp="2,71", plafond="plafond béton",
         porte_couloir=(93, 146), placards=[(2, 73), (399, 468)],
         porte_g=None, porte_d=dict(battant="dedans")),
    dict(num=7, salle="CP A", hsfp="2,70", hsp="2,70", plafond="plafond béton",
         porte_couloir=(97, 151), placards=[(2, 77), (403, 472)],
         porte_g=dict(battant="dehors"), porte_d=None),
]
PLACARD_P = px(27)                 # profondeur des placards (0,42 m)
PORTE_LAT = (px(35), px(92))       # portes latérales : de 0,54 à 1,42 m depuis la façade


def new_doc():
    doc = ezdxf.new("R2010", setup=False)
    doc.units = ezdxf.units.M
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$DIMDSEP"] = ord(",")
    doc.styles.new("ARIAL", dxfattribs={"font": "arial.ttf"})
    for name, color, lw in [("CONTOUR_INTERIEUR", 1, 25), ("MURS", 7, 50),
                            ("MURS_HACHURES", 8, 13), ("PORTES", 4, 18),
                            ("PLACARDS", 30, 25), ("COTES", 3, 13),
                            ("TEXTES", 2, 18), ("FACADE_MENUISERIES", 5, 18)]:
        doc.layers.add(name, color=color, lineweight=lw)
    ds = doc.dimstyles.new("COTES_M")
    ds.dxf.dimtxsty = "ARIAL"
    ds.dxf.dimtxt = 0.125      # 2,5 mm imprimé au 1/50
    ds.dxf.dimasz = 0.08
    ds.dxf.dimblk = "ARCHTICK"
    ds.dxf.dimexe = 0.06
    ds.dxf.dimexo = 0.05
    ds.dxf.dimgap = 0.04
    ds.dxf.dimdec = 2
    ds.dxf.dimdsep = ord(",")
    ds.dxf.dimlunit = 2
    ds.dxf.dimzin = 0
    ds.dxf.dimtad = 1
    ds.dxf.dimpost = "<> m"
    ds.dxf.dimclrd = 3
    ds.dxf.dimclre = 3
    doc.header["$DIMSTYLE"] = "COTES_M"
    doc.header["$TEXTSTYLE"] = "ARIAL"
    return doc


def rect(msp, x0, y0, x1, y1, layer):
    return msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True,
                              dxfattribs={"layer": layer})


def wall(msp, pts, ox):
    pts = [(x + ox, y) for x, y in pts]
    msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "MURS"})
    h = msp.add_hatch(dxfattribs={"layer": "MURS_HACHURES"})
    h.set_pattern_fill("ANSI31", scale=0.01, style=0)
    h.paths.add_polyline_path(pts, is_closed=True, flags=1)


def text(msp, s, x, y, h, layer="TEXTES"):
    t = msp.add_text(s, height=h, dxfattribs={"layer": layer, "style": "ARIAL"})
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)


def dim(msp, p1, p2, base, angle=0):
    d = msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, dimstyle="COTES_M",
                           dxfattribs={"layer": "COTES"})
    d.render()


def draw_classe(msp, c, ox=0.0, seul=True, voisin_gauche=False, cote_prof=True):
    """Dessine une classe ; origine = angle intérieur façade / cloison gauche."""
    tc, tf = T_CLOISON, T_FACADE
    e = tc if seul else tc / 2   # épaisseur de cloison dessinée de chaque côté
    a, b = (px(v) for v in c["porte_couloir"])
    y0l, y1l = PORTE_LAT

    # contour intérieur exact
    rect(msp, ox, 0, ox + W, D, "CONTOUR_INTERIEUR")

    # mur côté couloir, interrompu par la porte
    wall(msp, [(-e, D), (a, D), (a, D + tc), (-e, D + tc)], ox)
    wall(msp, [(b, D), (W + e, D), (W + e, D + tc), (b, D + tc)], ox)
    # façade (vitrée) + meneau central
    xg, xd = -e, W + e
    rect(msp, ox + xg, -tf, ox + xd, 0, "FACADE_MENUISERIES")
    msp.add_line((ox + xg, -tf / 2), (ox + xd, -tf / 2), dxfattribs={"layer": "FACADE_MENUISERIES"})
    msp.add_line((ox + W / 2, -tf), (ox + W / 2, 0), dxfattribs={"layer": "FACADE_MENUISERIES"})

    # cloisons latérales (demi-épaisseur côté classe pour l'assemblage)
    for side, porte in (("g", c["porte_g"]), ("d", c["porte_d"])):
        xa, xb = (-e, 0) if side == "g" else (W, W + e)
        if porte is not None:
            wall(msp, [(xa, -tf), (xb, -tf), (xb, y0l), (xa, y0l)], ox)
            wall(msp, [(xa, y1l), (xb, y1l), (xb, D + tc), (xa, D + tc)], ox)
        else:
            wall(msp, [(xa, -tf), (xb, -tf), (xb, D + tc), (xa, D + tc)], ox)

    # porte couloir : pivot à gauche, ouvre vers l'intérieur
    r = b - a
    msp.add_line((ox + a, D), (ox + a, D - r), dxfattribs={"layer": "PORTES"})
    msp.add_arc((ox + a, D), r, 270, 360, dxfattribs={"layer": "PORTES"})

    # portes latérales : pivot côté façade, battant horizontal
    rl = y1l - y0l
    if c["porte_d"] and c["porte_d"]["battant"] == "dedans":
        msp.add_line((ox + W, y0l), (ox + W - rl, y0l), dxfattribs={"layer": "PORTES"})
        msp.add_arc((ox + W, y0l), rl, 90, 180, dxfattribs={"layer": "PORTES"})
    if c["porte_g"] and c["porte_g"]["battant"] == "dehors" and not voisin_gauche:
        x = ox - tc
        msp.add_line((x, y0l), (x - rl, y0l), dxfattribs={"layer": "PORTES"})
        msp.add_arc((x, y0l), rl, 90, 180, dxfattribs={"layer": "PORTES"})

    # placards le long du mur couloir
    for x0, x1 in c["placards"]:
        rect(msp, ox + px(x0), D - PLACARD_P, ox + px(x1), D, "PLACARDS")

    # textes
    cx = ox + W / 2
    text(msp, f"Classe {c['num']} – {c['salle']}", cx, D / 2 + 0.75, 0.30)
    text(msp, f"S = {W * D:.2f} m²".replace(".", ","), cx, D / 2 + 0.25, 0.20)
    text(msp, f"HSFP {c['hsfp']} m – {c['plafond']}", cx, D / 2 - 0.15, 0.15)
    text(msp, f"HSP {c['hsp']} m", cx, D / 2 - 0.45, 0.15)

    # cotes
    dim(msp, (ox, 0), (ox + W, 0), base=(cx, -tf - 0.55))                                 # largeur
    if cote_prof:
        dim(msp, (ox, 0), (ox, D), base=(ox - tc - 1.05, D / 2), angle=90)               # profondeur
    dim(msp, (ox, D), (ox + a, D), base=(cx, D + tc + 0.45))                              # trumeau
    dim(msp, (ox + a, D), (ox + b, D), base=(cx, D + tc + 0.45))                          # porte couloir
    dim(msp, (ox + b, D), (ox + W, D), base=(cx, D + tc + 0.45))
    for x0, x1 in c["placards"]:
        dim(msp, (ox + px(x0), D - PLACARD_P), (ox + px(x0), D),
            base=(ox + px(x0) + (0.25 if x0 < 200 else -0.25), D - 0.2), angle=90)
        dim(msp, (ox + px(x0), D - PLACARD_P), (ox + px(x1), D - PLACARD_P),
            base=(ox + (px(x0) + px(x1)) / 2, D - PLACARD_P - 0.3))
    cotes_lat = []
    if c["porte_d"]:
        cotes_lat.append(ox + W)
    if c["porte_g"] and not voisin_gauche:
        cotes_lat.append(ox)
    for side_x in cotes_lat:
        bx = side_x + (-0.35 if side_x > ox else 0.35)
        dim(msp, (side_x, 0), (side_x, y0l), base=(bx, 0.3), angle=90)
        dim(msp, (side_x, y0l), (side_x, y1l), base=(bx, 0.3), angle=90)


def main(out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    for c in CLASSES:
        doc = new_doc()
        draw_classe(doc.modelspace(), c)
        p = out_dir / f"Classe_{c['num']}_{c['salle'].replace(' ', '_')}.dxf"
        doc.saveas(p)
        print(p)
    doc = new_doc()
    msp = doc.modelspace()
    for i, c in enumerate(CLASSES):
        draw_classe(msp, c, ox=i * PAS, seul=False, voisin_gauche=i > 0, cote_prof=i == 0)
    text(msp, "C O U L O I R", 2 * PAS + W / 2, D + T_CLOISON + 1.2, 0.35)
    text(msp, "F A Ç A D E", 2 * PAS + W / 2, -T_FACADE - 1.3, 0.35)
    text(msp, "École élémentaire 14 rue Mathis – R+1 – Classes 3 à 7 – cotes intérieures en m",
         2 * PAS + W / 2, D + T_CLOISON + 1.9, 0.30)
    p = out_dir / "Classes_3_a_7_ensemble.dxf"
    doc.saveas(p)
    print(p)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "classes"))
