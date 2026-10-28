#!/usr/bin/env python3
"""Ajuste le projet Android généré par Capacitor : permission de localisation (« Autour de moi »)
et affichage sous la barre d'état désactivé sur Android 15 (sinon la barre masque l'en-tête)."""
import os
import re
import sys

root = sys.argv[1] if len(sys.argv) > 1 else "android"
main = os.path.join(root, "app", "src", "main")

# 1. Permissions
manifest_path = os.path.join(main, "AndroidManifest.xml")
manifest = open(manifest_path, encoding="utf-8").read()
perms = [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
]
added = []
for p in perms:
    if p not in manifest:
        manifest = manifest.replace("</manifest>", '    <uses-permission android:name="%s" />\n</manifest>' % p)
        added.append(p)
open(manifest_path, "w", encoding="utf-8").write(manifest)
print("Permissions ajoutées :", ", ".join(added) or "aucune (déjà présentes)")

# 2. Android 15 : pas d'affichage sous la barre d'état
styles_path = os.path.join(main, "res", "values", "styles.xml")
styles = open(styles_path, encoding="utf-8").read()
blocks = []
for name in ("AppTheme.NoActionBar", "AppTheme.NoActionBarLaunch"):
    m = re.search(r'<style\s+name="%s"[^>]*>.*?</style>' % re.escape(name), styles, re.S)
    if m:
        blocks.append(m.group(0).replace(
            "</style>",
            '    <item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>\n    </style>',
        ))
if blocks:
    v35 = os.path.join(main, "res", "values-v35")
    os.makedirs(v35, exist_ok=True)
    with open(os.path.join(v35, "styles.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    ' + "\n    ".join(blocks) + "\n</resources>\n")
    print("Style Android 15 ajouté (%d thèmes)" % len(blocks))
else:
    print("::warning::Thèmes Capacitor introuvables, ajustement Android 15 ignoré")
