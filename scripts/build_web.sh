#!/usr/bin/env bash
# Prépare le site dans un dossier (par défaut dist/) : copie www/, télécharge les bibliothèques
# de carte (versions figées) et remplit les adresses à partir du dépôt GitHub.
#   bash scripts/build_web.sh dist
#   SKIP_VENDOR=1 bash scripts/build_web.sh dist   (sans téléchargement, pour un test local)
set -euo pipefail

OUT="${1:-dist}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$ROOT/www/." "$OUT/"

LEAFLET=1.9.4
CLUSTER=1.5.3
mkdir -p "$OUT/vendor"
fetch() { # fetch <destination> <url> [url de secours]
  local dest="$1"; shift
  for url in "$@"; do
    if curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url"; then return 0; fi
  done
  echo "Téléchargement impossible : $dest" >&2; return 1
}
if [ "${SKIP_VENDOR:-0}" != "1" ]; then
  fetch "$OUT/vendor/leaflet.js" \
    "https://cdn.jsdelivr.net/npm/leaflet@$LEAFLET/dist/leaflet.js" \
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/$LEAFLET/leaflet.js"
  fetch "$OUT/vendor/leaflet.css" \
    "https://cdn.jsdelivr.net/npm/leaflet@$LEAFLET/dist/leaflet.css" \
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/$LEAFLET/leaflet.css"
  fetch "$OUT/vendor/leaflet.markercluster.js" \
    "https://cdn.jsdelivr.net/npm/leaflet.markercluster@$CLUSTER/dist/leaflet.markercluster.js" \
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/$CLUSTER/leaflet.markercluster.js"
  fetch "$OUT/vendor/MarkerCluster.css" \
    "https://cdn.jsdelivr.net/npm/leaflet.markercluster@$CLUSTER/dist/MarkerCluster.css" \
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/$CLUSTER/MarkerCluster.css"
fi

# Adresses publiques déduites du dépôt GitHub (ex. riwan/tayyib -> https://riwan.github.io/tayyib/)
REPO_FULL="${GITHUB_REPOSITORY:-proprietaire/tayyib}"
OWNER="${REPO_FULL%%/*}"
NAME="${REPO_FULL#*/}"
OWNER_LC="$(echo "$OWNER" | tr '[:upper:]' '[:lower:]')"
if [ -n "${SITE_URL:-}" ]; then
  SITE="${SITE_URL%/}/"
elif [ "$(echo "$NAME" | tr '[:upper:]' '[:lower:]')" = "$OWNER_LC.github.io" ]; then
  SITE="https://$OWNER_LC.github.io/"
else
  SITE="https://$OWNER_LC.github.io/$NAME/"
fi
BUILD="$(date -u +%Y%m%d%H%M)-${GITHUB_SHA:-local}"
BUILD="${BUILD:0:24}"

for f in "$OUT/config.js" "$OUT/sw.js" "$OUT/mentions-legales.html" "$OUT/confidentialite.html"; do
  [ -f "$f" ] || continue
  sed -i.bak -e "s#__SITE_URL__#$SITE#g" -e "s#__REPO__#$REPO_FULL#g" -e "s#__BUILD__#$BUILD#g" "$f"
  rm -f "$f.bak"
done
# Un domaine personnalisé ? Créez le fichier www/CNAME (ex. tayyib.fr) et définissez SITE_URL.
touch "$OUT/.nojekyll"
echo "Site prêt dans $OUT (adresse : $SITE)"
