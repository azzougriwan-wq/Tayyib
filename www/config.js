/* Réglages de Tayyib. Les valeurs entre __doubles_tirets__ sont remplies
   automatiquement par GitHub lors de la publication : ne pas les modifier. */
window.TAYYIB_CONFIG = {
  appName: 'Tayyib',

  // Adresse publique du site et de la liste (remplies automatiquement)
  siteUrl: '__SITE_URL__',
  remoteDataUrl: '__SITE_URL__data/restaurants.json',
  apkUrl: 'https://github.com/__REPO__/releases/download/android/tayyib.apk',

  // DONS — colle ici ton lien PayPal.Me (ex. 'https://paypal.me/tonpseudo')
  // ou le lien d'un bouton « Faire un don » PayPal. Vide = bouton masqué.
  paypalDonateUrl: '',

  // CONTACT — adresse affichée dans les mentions légales et pour signaler une erreur.
  // Conseil : crée une adresse dédiée plutôt que ton adresse personnelle.
  contactEmail: '',

  // FORMULAIRE « Proposer un restaurant / signaler une erreur » (ex. un Google Form).
  // Vide = l'appli affiche l'adresse de contact à la place.
  suggestFormUrl: '',

  // Fond de carte OpenStreetMap (gratuit pour un trafic modéré, attribution obligatoire)
  tiles: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
    maxZoom: 19
  },

  // NOTE GOOGLE — clé API Google Places (New). Vide = lien « Voir les avis Google » seulement.
  googlePlacesKey: '',

  // PUBLICITÉ (site uniquement) — identifiant AdSense 'ca-pub-…' et numéro d'emplacement.
  // Vide = aucune pub, aucun cookie publicitaire.
  ads: { adsenseClient: '', listSlot: '', every: 12 }
};
