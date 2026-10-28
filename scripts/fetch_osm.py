#!/usr/bin/env python3
"""Récupère les restaurants halal de Paris et de la petite couronne depuis OpenStreetMap.

Exécuté chaque semaine par GitHub Actions. Aucune dépendance externe.

Usage :
  python3 scripts/fetch_osm.py --out www/data/restaurants.json --overrides data/overrides.json
  python3 scripts/fetch_osm.py --fixture tests/fixture_overpass.json --out /tmp/test.json
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request

DEPARTEMENTS = ["75", "92", "93", "94"]

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

USER_AGENT = "Tayyib/1.0 (annuaire de restaurants halal; https://github.com/%s)" % os.environ.get(
    "GITHUB_REPOSITORY", "tayyib"
)

QUERY = """[out:json][timeout:180];
(
  area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="{dep}"];
  area["boundary"="administrative"]["admin_level"="6"]["ref"="{dep}"];
  {extra}
)->.dep;
(
  nwr(area.dep)["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream)$"]["diet:halal"~"^(yes|only)$"];
  nwr(area.dep)["amenity"~"^(restaurant|fast_food|cafe)$"]["halal"~"^(yes|only)$"];
  nwr(area.dep)["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"(^|;)halal(;|$)"];
);
out center tags;
"""

# Paris est à la fois commune et département : on ajoute la commune par sécurité.
EXTRA_AREA = {"75": 'area["boundary"="administrative"]["ref:INSEE"="75056"];'}

# Valeurs OSM « cuisine » -> catégories de l'appli
CUISINE_MAP = {
    "kebab": ["kebab", "doner", "döner", "gyros", "shawarma"],
    "turque": ["turkish", "anatolian"],
    "libanaise": ["lebanese"],
    "maghreb": ["moroccan", "algerian", "tunisian", "north_african", "maghreb", "couscous", "berber"],
    "moyen_orient": ["middle_eastern", "syrian", "iraqi", "iranian", "persian", "afghan", "kurdish",
                     "arab", "arabic", "yemeni", "palestinian", "jordanian", "egyptian", "saudi"],
    "indo_pak": ["indian", "pakistani", "bangladeshi", "sri_lankan", "tandoori", "curry", "nepalese", "biryani"],
    "burger": ["burger", "hamburger", "smash_burger"],
    "poulet": ["chicken", "fried_chicken", "wings", "rotisserie", "rotisserie_chicken"],
    "pizza": ["pizza"],
    "tacos": ["tacos", "french_tacos", "mexican", "tex-mex", "burrito"],
    "sandwich": ["sandwich", "bagel", "panini", "sub", "wrap", "bánh_mì"],
    "asiatique": ["asian", "chinese", "thai", "japanese", "sushi", "vietnamese", "korean", "indonesian",
                  "malaysian", "noodle", "ramen", "wok", "uyghur", "dim_sum", "pho"],
    "africaine": ["african", "senegalese", "ivorian", "ethiopian", "eritrean", "malian", "cameroonian",
                  "west_african", "congolese", "comorian", "somali", "guinean"],
    "grillades": ["grill", "barbecue", "bbq", "steak_house", "meat", "brazilian"],
    "francaise": ["french", "regional", "brasserie", "bistro", "crepe", "galette"],
    "italienne": ["italian", "pasta"],
    "dessert": ["dessert", "ice_cream", "cake", "pastry", "waffle", "coffee_shop", "tea", "juice",
                "bubble_tea", "cookies", "donut", "chocolate", "oriental_pastry"],
}
CUISINE_LOOKUP = {v: k for k, vals in CUISINE_MAP.items() for v in vals}

CERT_KEYS = ["diet:halal:certification", "halal:certification", "certification:halal", "halal:certified_by"]


def yes_no(value):
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in ("yes", "only", "true", "1", "required", "recommended"):
        return True
    if v in ("no", "false", "0", "none"):
        return False
    return None


def first(tags, *keys):
    for k in keys:
        v = tags.get(k)
        if v:
            return v.strip()
    return None


def cuisines_of(tags, amenity):
    raw = (tags.get("cuisine") or "").lower().replace(" ", "_")
    cats = []
    for part in [p for p in raw.split(";") if p]:
        cat = CUISINE_LOOKUP.get(part)
        if cat and cat not in cats:
            cats.append(cat)
    if not cats:
        if amenity == "ice_cream":
            cats = ["dessert"]
        elif amenity == "cafe":
            cats = ["dessert"]
        else:
            cats = ["autre"]
    return cats


def alcohol_of(tags):
    explicit = yes_no(first(tags, "alcohol", "drink:alcohol"))
    if explicit is not None:
        return explicit
    for k in ("drink:beer", "drink:wine", "drink:spirits", "bar"):
        if yes_no(tags.get(k)) is True:
            return True
    return None


def price_of(tags, amenity):
    """Fourchette par personne. Les fast-foods et cafés sont estimés à moins de 15 €."""
    explicit = first(tags, "price_range", "price:range")
    if explicit:
        e = explicit.strip()
        if e in ("€", "$", "1", "cheap", "low"):
            return "lt15", False
        if e in ("€€", "$$", "2", "medium", "moderate"):
            return "15-30", False
        if e in ("€€€", "€€€€", "$$$", "3", "4", "expensive", "high"):
            return "gt30", False
    if amenity in ("fast_food", "cafe", "ice_cream", "food_court"):
        return "lt15", True
    return None, False


def convert(el, dep):
    tags = el.get("tags") or {}
    name = (tags.get("name") or "").strip()
    if not name:
        return None
    if el["type"] == "node":
        lat, lon = el.get("lat"), el.get("lon")
    else:
        c = el.get("center") or {}
        lat, lon = c.get("lat"), c.get("lon")
    if lat is None or lon is None:
        return None

    amenity = tags.get("amenity", "restaurant")
    street = " ".join(x for x in [tags.get("addr:housenumber"), tags.get("addr:street")] if x)
    postcode = tags.get("addr:postcode")
    city = tags.get("addr:city") or ("Paris" if dep == "75" else None)
    if postcode and postcode[:2] in DEPARTEMENTS:
        dep = postcode[:2]

    halal_tag = (tags.get("diet:halal") or "").lower()
    cert = first(tags, *CERT_KEYS)
    if cert:
        level = "certifie"
    elif halal_tag in ("yes", "only"):
        level = "declare"
    else:
        level = "non_verifie"

    wheelchair = (tags.get("wheelchair") or "").lower()
    price, price_est = price_of(tags, amenity)

    item = {
        "id": el["type"][0] + str(el["id"]),
        "osm": "%s/%s" % (el["type"], el["id"]),
        "name": name,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "dep": dep,
        "type": amenity,
        "addr": street or None,
        "cp": postcode,
        "city": city,
        "cuisines": cuisines_of(tags, amenity),
        "cuisineRaw": tags.get("cuisine"),
        "price": price,
        "priceEst": price_est or None,
        "oh": tags.get("opening_hours"),
        "terrace": yes_no(tags.get("outdoor_seating")),
        "takeaway": yes_no(tags.get("takeaway")),
        "delivery": yes_no(tags.get("delivery")),
        "reservation": yes_no(tags.get("reservation")),
        "wheelchair": wheelchair if wheelchair in ("yes", "limited", "no") else None,
        "alcohol": alcohol_of(tags),
        "halal": level,
        "halalOnly": True if halal_tag == "only" else None,
        "cert": cert,
        "phone": first(tags, "phone", "contact:phone"),
        "website": first(tags, "website", "contact:website", "url"),
    }
    return {k: v for k, v in item.items() if v is not None}


def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(2):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)
            except Exception as e:  # noqa: BLE001
                last = e
                print("  échec %s : %s" % (url, e), file=sys.stderr)
                time.sleep(5)
        time.sleep(20)
    raise RuntimeError("Overpass indisponible : %s" % last)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def apply_overrides(items, overrides):
    by_id = {it["id"]: it for it in items}
    for rid in overrides.get("remove", []):
        by_id.pop(rid, None)
    for rid, patch in (overrides.get("edit") or {}).items():
        if rid in by_id:
            by_id[rid].update(patch)
            by_id[rid] = {k: v for k, v in by_id[rid].items() if v is not None}
    for extra in overrides.get("add", []):
        if extra.get("id") and extra.get("name") and extra.get("lat") is not None:
            extra.setdefault("halal", "declare")
            extra.setdefault("cuisines", ["autre"])
            extra["manual"] = True
            by_id[extra["id"]] = {k: v for k, v in extra.items() if v is not None}
    return list(by_id.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--overrides", default="data/overrides.json")
    ap.add_argument("--fixture", help="Fichier JSON local {dep: réponse Overpass} pour les tests")
    ap.add_argument("--min-per-dep", type=int, default=5)
    args = ap.parse_args()

    previous = load_json(args.out, {"items": []})
    prev_items = [i for i in previous.get("items", []) if not i.get("manual")]
    fixture = load_json(args.fixture, None) if args.fixture else None

    items, seen = [], set()
    for i, dep in enumerate(DEPARTEMENTS):
        try:
            if fixture is not None:
                resp = fixture.get(dep, {"elements": []})
            else:
                if i:
                    time.sleep(10)  # politesse envers le serveur Overpass
                print("Département %s…" % dep)
                q = QUERY.replace("{dep}", dep).replace("{extra}", EXTRA_AREA.get(dep, ""))
                resp = overpass(q)
            got = []
            for el in resp.get("elements", []):
                it = convert(el, dep)
                if it and it["id"] not in seen:
                    seen.add(it["id"])
                    got.append(it)
            if len(got) < args.min_per_dep:
                raise RuntimeError("seulement %d résultats" % len(got))
            print("  %d restaurants" % len(got))
            items.extend(got)
        except Exception as e:  # noqa: BLE001
            kept = [it for it in prev_items if it.get("dep") == dep and it["id"] not in seen]
            print("::warning::Département %s non mis à jour (%s). %d entrées précédentes conservées."
                  % (dep, e, len(kept)), file=sys.stderr)
            for it in kept:
                seen.add(it["id"])
            items.extend(kept)

    items = apply_overrides(items, load_json(args.overrides, {}))
    items.sort(key=lambda it: (it["name"].lower(), it["id"]))

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    unchanged = previous.get("items") == items
    out = {
        "updated": previous.get("updated") if unchanged and previous.get("updated") else now,
        "checked": now,
        "count": len(items),
        "source": "OpenStreetMap",
        "license": "ODbL 1.0 — © les contributeurs OpenStreetMap",
        "items": items,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("%d restaurants écrits dans %s" % (len(items), args.out))


if __name__ == "__main__":
    main()
