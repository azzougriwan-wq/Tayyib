# Tayyib — restaurants halal à Paris et en petite couronne

Site web + appli Android qui recensent les restaurants halal de Paris (75), des Hauts-de-Seine (92), de Seine-Saint-Denis (93) et du Val-de-Marne (94).

- **Carte et liste**, recherche, tri par nom, par distance ou « ouverts d’abord »
- **Filtres** : type de cuisine, prix par personne, horaires et « ouvert maintenant », terrasse, vente à emporter, livraison, réservation, accès fauteuil roulant, alcool, niveau halal (certifié / déclaré / non vérifié), département
- **Autour de moi**, favoris, partage d’une fiche, mode sombre, français / anglais, fonctionne hors connexion
- **Dons PayPal** intégrés, emplacements publicitaires prêts (désactivés)
- **Mise à jour automatique chaque lundi** à partir d’OpenStreetMap, sans serveur à payer

Tout tourne gratuitement sur GitHub : GitHub Pages héberge le site, GitHub Actions met la liste à jour et fabrique l’APK.

---

## 1. Mise en ligne (une seule fois, environ 15 minutes)

1. **Créer le dépôt** : sur github.com, bouton **New repository**, nom `tayyib`, visibilité **Public** (obligatoire pour GitHub Pages gratuit), sans README.
2. **Envoyer les fichiers** de ce dossier dans le dépôt (bouton **Add file > Upload files**, ou `git push`).
3. **Activer le site** : **Settings > Pages > Build and deployment > Source : GitHub Actions**.
4. **Clé de signature de l’APK** : **Settings > Secrets and variables > Actions > New repository secret**, deux fois :
   - Name `ANDROID_KEYSTORE_B64`, Secret : tout le contenu du fichier `ANDROID_KEYSTORE_B64.txt` fourni à part ;
   - Name `ANDROID_KEYSTORE_PASSWORD`, Secret : le mot de passe fourni à part.

   Garde ces deux éléments précieusement et hors du dépôt : ils signent toutes les futures versions de l’appli.
5. **Lancer la première publication** : onglet **Actions**, choisir **Site et liste des restaurants**, puis **Run workflow**. Recommencer avec **Appli Android (APK)**.

Après quelques minutes :

| Quoi | Adresse |
|---|---|
| Site | `https://<ton-compte>.github.io/tayyib/` |
| APK Android | `https://github.com/<ton-compte>/tayyib/releases/download/android/tayyib.apk` |

Ces adresses sont remplies automatiquement dans l’appli, il n’y a rien à modifier.

**Installer l’APK** : ouvrir le lien sur le téléphone Android, télécharger, puis autoriser l’installation depuis le navigateur quand Android le demande.

## 2. Recevoir des dons (PayPal)

1. Créer un lien **PayPal.Me** sur paypal.me (ou un bouton « Faire un don » depuis ton compte PayPal).
2. Ouvrir `www/config.js` sur GitHub (icône crayon), coller le lien dans `paypalDonateUrl`, puis **Commit changes**.

Le bouton apparaît alors dans le menu et dans un encart en haut de la liste (que chaque visiteur peut masquer). Les dons arrivent sur ton compte PayPal, que tu vires ensuite sur ton compte bancaire.

À renseigner au même endroit :
- `contactEmail` : adresse de contact (de préférence une adresse dédiée, elle est publique) ;
- `suggestFormUrl` : lien d’un Google Form « Proposer un restaurant / signaler une erreur ». Sans formulaire, l’appli affiche l’adresse de contact.

## 3. Corriger ou ajouter un restaurant

Deux façons :

- **Sur OpenStreetMap** (recommandé) : chaque fiche de l’appli a un lien « Corriger sur OpenStreetMap ». La correction profite à tout le monde et apparaît dans Tayyib au lundi suivant.
- **Dans `data/overrides.json`**, pour une correction propre à Tayyib (identifiant visible dans l’adresse de la fiche, ex. `#r-n123456`) :

```json
{
  "remove": ["n123456"],
  "edit": {
    "n654321": { "halal": "certifie", "cert": "AVS", "price": "15-30", "alcohol": false }
  },
  "add": [
    { "id": "x-1", "name": "Nom du restaurant", "lat": 48.8841, "lon": 2.3712, "dep": "75",
      "addr": "12 rue Exemple", "cp": "75019", "city": "Paris", "cuisines": ["turque"],
      "price": "lt15", "oh": "Mo-Su 11:00-23:00", "terrace": true, "takeaway": true, "halal": "declare" }
  ]
}
```

Valeurs possibles :
- `halal` : `certifie`, `declare`, `non_verifie`
- `price` : `lt15` (moins de 15 €), `15-30`, `gt30` (plus de 30 €)
- `cuisines` : `kebab`, `turque`, `libanaise`, `maghreb`, `moyen_orient`, `indo_pak`, `burger`, `poulet`, `pizza`, `tacos`, `sandwich`, `asiatique`, `africaine`, `grillades`, `francaise`, `italienne`, `dessert`, `autre`
- `oh` : horaires au format OpenStreetMap, ex. `Mo-Fr 11:30-14:30,18:30-23:00; Sa,Su 12:00-00:00`

Les modifications sont prises en compte à la prochaine publication (relancer **Site et liste des restaurants** pour ne pas attendre lundi).

## 4. Plus tard

**Note Google.** Créer une clé « Places API (New) » dans Google Cloud (carte bancaire demandée, quota gratuit puis payant), la restreindre à l’adresse du site, et la coller dans `googlePlacesKey`. Les conditions de Google interdisent de stocker les notes : l’appli les charge à l’ouverture de chaque fiche.

**Publicité sur le site.** Il faut d’abord un nom de domaine à toi (Google AdSense refuse les adresses en `github.io`) :
1. acheter le domaine, créer le fichier `www/CNAME` contenant le domaine (ex. `tayyib.fr`), le déclarer dans **Settings > Pages > Custom domain**, et ajouter la variable `SITE_URL` (**Settings > Secrets and variables > Actions > Variables**) ;
2. demander la validation AdSense, activer le message de consentement RGPD de Google (**Confidentialité et messages**) ;
3. coller l’identifiant `ca-pub-…` et le numéro d’emplacement dans `ads` de `config.js`, puis mettre à jour `confidentialite.html`.

La publicité dans l’APK passe par Google AdMob et demande un module supplémentaire : à prévoir avec la publication sur le Play Store.

**Play Store.** Compte développeur Google (25 $, une fois). L’APK est déjà signé avec une clé stable, gardée dans les secrets GitHub.

## 5. Obligations

- **Mentions légales** : compléter les champs surlignés dans `www/mentions-legales.html` (nom de l’éditeur). Dès que l’appli génère des revenus réguliers, ils sont à déclarer (souvent en micro-entreprise) : vérifier auprès de l’Urssaf ou d’un comptable.
- **OpenStreetMap** : la mention « © contributeurs OpenStreetMap » doit rester visible (déjà faite sur la carte, dans le menu et les fiches). La liste dérivée est diffusée sous licence ODbL.
- **Halal** : l’appli affiche le niveau d’information disponible, pas une certification. Le texte d’avertissement est dans le menu et les mentions légales.

## Organisation des fichiers

```
www/                    Le site et l'appli (HTML, CSS, JS)
  config.js             Réglages : PayPal, contact, formulaire, Google, pub
  data/restaurants.json Liste générée automatiquement (ne pas modifier à la main)
data/overrides.json     Corrections manuelles
scripts/fetch_osm.py    Récupération hebdomadaire depuis OpenStreetMap
scripts/build_web.sh    Préparation du site
scripts/patch_android.py Réglages Android (localisation, Android 15)
resources/              Icônes et écran de démarrage de l'APK
.github/workflows/      Automatisations GitHub (site + APK)
tests/                  Tests des horaires et de la conversion des données
```

Tester en local : `npm test`, puis `SKIP_VENDOR=1 bash scripts/build_web.sh dist` et ouvrir `dist/` avec un petit serveur web.
