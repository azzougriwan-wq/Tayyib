/* Tayyib — logique de l'appli (site et APK). Aucune dépendance hormis Leaflet pour la carte. */
(function () {
  'use strict';

  var CFG = window.TAYYIB_CONFIG || {};
  var I18N = window.TAYYIB_I18N || { fr: {} };
  var H = window.TayyibHours;
  var IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var IS_ANDROID = /Android/i.test(navigator.userAgent);
  var DEPS = ['75', '92', '93', '94'];
  var PRICES = ['lt15', '15-30', 'gt30'];
  var LEVELS = ['certifie', 'declare', 'non_verifie'];
  var PAGE = 40;

  function configured(v) { return typeof v === 'string' && v.length > 0 && v.indexOf('__') < 0; }

  /* ---------- Stockage local (favoris, préférences) ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('tayyib.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tayyib.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  function defaultFilters() {
    return { q: '', cuisines: new Set(), prices: new Set(), deps: new Set(), levels: new Set(),
      openNow: false, terrace: false, takeaway: false, delivery: false, reservation: false, wheelchair: false,
      alcohol: 'any', favOnly: false };
  }

  var navLang = (navigator.language || 'fr').slice(0, 2);
  var state = {
    lang: store.get('lang', navLang === 'en' ? 'en' : 'fr'),
    theme: store.get('theme', 'auto'),
    view: store.get('view', 'map'),
    sort: 'name',
    items: [],
    byId: new Map(),
    meta: null,
    results: [],
    shown: PAGE,
    favs: new Set(store.get('favs', [])),
    filters: defaultFilters(),
    userPos: null,
    map: null, cluster: null, meMarker: null, iconCache: {},
    installEvt: null,
    adsLoaded: false
  };

  /* ---------- Outils ---------- */
  function $(s, root) { return (root || document).querySelector(s); }
  function $all(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function t(key, vars) {
    var dict = I18N[state.lang] || I18N.fr;
    var s = dict[key] != null ? dict[key] : (I18N.fr[key] != null ? I18N.fr[key] : key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function icon(id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function debounce(fn, ms) { var h; return function () { var a = arguments; clearTimeout(h); h = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function countLabel(n) { return n === 0 ? t('count.zero') : n === 1 ? t('count.one') : t('count.many', { n: n.toLocaleString(state.lang === 'fr' ? 'fr-FR' : 'en-GB') }); }
  function distance(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) {
    if (m < 950) return Math.round(m / 10) * 10 + ' m';
    return (m / 1000).toLocaleString(state.lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 }) + ' km';
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(state.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return iso; }
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* Liens externes : nouvel onglet sur le site, navigateur du téléphone dans l'APK */
  function extLink(href, label, iconId, cls) {
    return '<a class="' + (cls || 'act') + '" href="' + esc(href) + '" target="_blank" rel="noopener" data-ext>' +
      (iconId ? icon(iconId) : '') + '<span>' + esc(label) + '</span></a>';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-ext]');
    if (a && IS_NATIVE) { e.preventDefault(); window.location.href = a.getAttribute('href'); }
  });

  /* ---------- Thème et langue ---------- */
  function applyTheme() {
    var root = document.documentElement;
    if (state.theme === 'light' || state.theme === 'dark') root.setAttribute('data-theme', state.theme);
    else root.removeAttribute('data-theme');
  }
  function applyI18n() {
    document.documentElement.lang = state.lang;
    $all('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $all('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    $all('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  }

  /* ---------- Données ---------- */
  function prepare(data) {
    var items = (data && data.items) || [];
    items.forEach(function (it) {
      it._week = H.parse(it.oh);
      it.cuisines = it.cuisines && it.cuisines.length ? it.cuisines : ['autre'];
      it._s = norm([it.name, it.city, it.cp, it.addr, it.cuisineRaw].concat(it.cuisines.map(function (c) {
        return (I18N.fr['cuisine.' + c] || '') + ' ' + ((I18N.en || {})['cuisine.' + c] || '');
      })).join(' '));
    });
    return items;
  }
  function setData(data) {
    state.loaded = true;
    state.meta = data || null;
    state.items = prepare(data);
    state.byId = new Map(state.items.map(function (it) { return [it.id, it]; }));
    buildFilterSheet();
    applyFilters();
  }
  function newer(a, b) { return a && a.updated && (!b || !b.updated || a.updated > b.updated); }

  function loadData() {
    return fetch('data/restaurants.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (local) {
        var data = local;
        if (IS_NATIVE) {
          var cached = store.get('remoteData', null);
          if (newer(cached, data)) data = cached;
        }
        setData(data);
        if (IS_NATIVE && configured(CFG.remoteDataUrl)) refreshRemote();
      });
  }
  function refreshRemote() {
    fetch(CFG.remoteDataUrl, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (remote && remote.items && newer(remote, state.meta)) {
          store.set('remoteData', remote);
          setData(remote);
          toast(t('toast.dataUpdated'));
        }
      })
      .catch(function () { /* hors connexion : on garde la liste en mémoire */ });
  }

  /* ---------- Statut d'ouverture ---------- */
  function statusOf(it, now) {
    if (!it.oh) return { kind: 'unknown', text: t('status.unknown') };
    if (!it._week) return { kind: 'unknown', text: t('status.unparsed') };
    var s = H.status(it._week, now);
    if (!s) return { kind: 'unknown', text: t('status.unknown') };
    if (s.open) {
      if (s.allDay && it._week.every(function (d) { return d.length && d[0][0] === 0 && d[0][1] >= 1440; })) {
        return { kind: 'open', open: true, html: '<b>' + esc(t('status.open24')) + '</b>' };
      }
      var tail = s.until != null ? ' · ' + esc(t('status.closesAt', { t: H.fmt(s.until) })) : '';
      return { kind: 'open', open: true, html: '<b>' + esc(t('status.open')) + '</b>' + tail };
    }
    var nxt = '';
    if (s.next) {
      nxt = s.next.inDays === 0 ? t('status.opensAt', { t: H.fmt(s.next.min) })
        : t('status.opensDay', { d: s.next.inDays === 1 && state.lang === 'fr' ? 'demain' : s.next.inDays === 1 ? 'tomorrow' : t('day.' + s.next.day), t: H.fmt(s.next.min) });
    }
    return { kind: 'closed', open: false, html: '<b>' + esc(t('status.closed')) + '</b>' + (nxt ? ' · ' + esc(nxt) : '') };
  }
  function statusHtml(st) {
    return '<span class="status is-' + st.kind + '"><span>' + (st.html || esc(st.text)) + '</span></span>';
  }

  /* ---------- Filtres ---------- */
  function activeFilterCount() {
    var f = state.filters, n = f.cuisines.size + f.prices.size + f.deps.size + f.levels.size;
    ['openNow', 'terrace', 'takeaway', 'delivery', 'reservation', 'wheelchair', 'favOnly'].forEach(function (k) { if (f[k]) n++; });
    if (f.alcohol !== 'any') n++;
    return n;
  }
  function matches(it, f, q, now) {
    if (q && it._s.indexOf(q) < 0) return false;
    if (f.cuisines.size && !it.cuisines.some(function (c) { return f.cuisines.has(c); })) return false;
    if (f.prices.size && !f.prices.has(it.price)) return false;
    if (f.deps.size && !f.deps.has(it.dep)) return false;
    if (f.levels.size && !f.levels.has(it.halal)) return false;
    if (f.terrace && it.terrace !== true) return false;
    if (f.takeaway && it.takeaway !== true) return false;
    if (f.delivery && it.delivery !== true) return false;
    if (f.reservation && it.reservation !== true) return false;
    if (f.wheelchair && it.wheelchair !== 'yes') return false;
    if (f.alcohol === 'no' && it.alcohol !== false) return false;
    if (f.alcohol === 'yes' && it.alcohol !== true) return false;
    if (f.favOnly && !state.favs.has(it.id)) return false;
    if (f.openNow) { var s = H.status(it._week, now); if (!s || !s.open) return false; }
    return true;
  }
  function filterItems(f) {
    var q = norm(f.q), now = H.parisNow();
    return state.items.filter(function (it) { return matches(it, f, q, now); });
  }
  function applyFilters() {
    var res = filterItems(state.filters);
    var now = H.parisNow();
    if (state.userPos) res.forEach(function (it) { it._d = distance(state.userPos, it); });
    var byName = function (a, b) { return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }); };
    if (state.sort === 'distance' && state.userPos) res.sort(function (a, b) { return a._d - b._d; });
    else if (state.sort === 'open') {
      res.forEach(function (it) { var s = H.status(it._week, now); it._o = s ? (s.open ? 0 : 1) : 2; });
      res.sort(function (a, b) { return a._o - b._o || (state.userPos ? a._d - b._d : byName(a, b)); });
    } else res.sort(byName);
    state.results = res;
    state.shown = PAGE;
    syncChips();
    renderList();
    renderMarkers();
  }

  function syncChips() {
    var f = state.filters;
    var map = { openNow: f.openNow, terrace: f.terrace, takeaway: f.takeaway, delivery: f.delivery,
      noAlcohol: f.alcohol === 'no', certified: f.levels.size === 1 && f.levels.has('certifie'), favOnly: f.favOnly };
    $all('[data-chip]').forEach(function (b) { b.setAttribute('aria-pressed', map[b.getAttribute('data-chip')] ? 'true' : 'false'); });
    var n = activeFilterCount(), badge = $('#fCount');
    badge.hidden = n === 0;
    badge.textContent = n;
    $('#nearChip').classList.toggle('is-on', !!state.userPos);
  }
  function toggleChip(name) {
    var f = state.filters;
    if (name === 'noAlcohol') f.alcohol = f.alcohol === 'no' ? 'any' : 'no';
    else if (name === 'certified') {
      var on = f.levels.size === 1 && f.levels.has('certifie');
      f.levels = on ? new Set() : new Set(['certifie']);
    } else f[name] = !f[name];
    applyFilters();
  }

  /* ---------- Liste ---------- */
  function priceShort(it) { return it.price ? t('price.short.' + it.price) : ''; }
  function metaLine(it) {
    var parts = [it.cuisines.map(function (c) { return t('cuisine.' + c); }).slice(0, 2).join(', ')];
    if (it.price) parts.push(priceShort(it));
    var place = placeOf(it);
    parts.push(place);
    return parts.filter(Boolean).join(' · ');
  }
  function placeOf(it) {
    if (it.cp && /^75\d{3}$/.test(it.cp)) {
      var arr = it.cp === '75116' ? 16 : parseInt(it.cp.slice(3), 10);
      if (arr >= 1 && arr <= 20) return state.lang === 'fr' ? 'Paris ' + arr + (arr === 1 ? 'er' : 'e') : 'Paris ' + arr;
    }
    return it.city || t('dep.' + it.dep);
  }
  function tagsOf(it) {
    var out = [];
    if (it.halalOnly) out.push(t('halalOnly'));
    if (it.terrace) out.push(t('chip.terrace'));
    if (it.takeaway) out.push(t('chip.takeaway'));
    if (it.delivery) out.push(t('chip.delivery'));
    if (it.alcohol === false) out.push(t('chip.noalcohol'));
    return out;
  }
  function rowHtml(it, now) {
    var fav = state.favs.has(it.id);
    var tags = tagsOf(it);
    return '<article class="row" data-id="' + esc(it.id) + '">' +
      '<button type="button" class="row-main" data-open="' + esc(it.id) + '">' +
        '<span class="row-top"><span class="row-name">' + esc(it.name) + '</span>' +
          (it._d != null && state.userPos ? '<span class="row-dist">' + fmtDist(it._d) + '</span>' : '') + '</span>' +
        '<span class="row-meta">' + esc(metaLine(it)) + '</span>' +
        '<span class="row-top">' + statusHtml(statusOf(it, now)) + '<span class="lvl lvl-' + it.halal + '">' + esc(t('level.' + it.halal)) + '</span></span>' +
        (tags.length ? '<ul class="tags">' + tags.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '</button>' +
      '<button type="button" class="fav" data-fav="' + esc(it.id) + '" aria-pressed="' + fav + '" aria-label="' + esc(t(fav ? 'aria.unfav' : 'aria.fav')) + '">' + icon('star') + '</button>' +
    '</article>';
  }
  function promoHtml() {
    if (!state.items.length) return '';
    if (!IS_NATIVE && IS_ANDROID && configured(CFG.apkUrl) && !store.get('hideInstall', false)) {
      return '<aside class="promo" data-promo="install"><h3>' + esc(t('promo.install.title')) + '</h3><p>' + esc(t('promo.install.text')) + '</p>' +
        extLink(CFG.apkUrl, t('promo.install.btn'), 'download', 'btn btn-saffron') +
        '<button type="button" class="promo-x" data-dismiss="hideInstall" aria-label="' + esc(t('promo.dismiss')) + '">' + icon('close') + '</button></aside>';
    }
    if (configured(CFG.paypalDonateUrl) && !store.get('hideDonate', false)) {
      return '<aside class="promo" data-promo="donate"><h3>' + esc(t('promo.donate.title')) + '</h3><p>' + esc(t('promo.donate.text')) + '</p>' +
        extLink(CFG.paypalDonateUrl, t('promo.donate.btn'), 'heart', 'btn btn-saffron') +
        '<button type="button" class="promo-x" data-dismiss="hideDonate" aria-label="' + esc(t('promo.dismiss')) + '">' + icon('close') + '</button></aside>';
    }
    return '';
  }
  function adsOn() { return !IS_NATIVE && CFG.ads && configured(CFG.ads.adsenseClient) && configured(CFG.ads.listSlot); }
  function adHtml() {
    return '<div class="ad-slot"><small>' + esc(t('ad.label')) + '</small><ins class="adsbygoogle" style="display:block" data-ad-client="' +
      esc(CFG.ads.adsenseClient) + '" data-ad-slot="' + esc(CFG.ads.listSlot) + '" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
  }
  function renderList() {
    var list = $('#list'), res = state.results, now = H.parisNow();
    $('#count').textContent = countLabel(res.length);
    $('#mapCount').textContent = countLabel(res.length);
    if (!state.loaded) { list.innerHTML = '<div class="empty"><p>' + esc(t('list.loading')) + '</p></div>'; return; }
    if (!state.items.length) {
      list.innerHTML = '<div class="empty">' + icon('clock') + '<p>' + esc(t('empty.noData')) + '</p></div>';
      return;
    }
    if (!res.length) {
      list.innerHTML = '<div class="empty"><p>' + esc(t('empty.noResults')) + '</p><button type="button" class="btn btn-primary" data-reset>' + esc(t('empty.reset')) + '</button></div>';
      return;
    }
    var every = (CFG.ads && CFG.ads.every) || 12, html = [promoHtml()], ads = adsOn();
    res.slice(0, state.shown).forEach(function (it, i) {
      html.push(rowHtml(it, now));
      if (ads && (i + 1) % every === 0) html.push(adHtml());
    });
    if (res.length > state.shown) html.push('<button type="button" class="more" data-more>' + esc(t('list.more')) + ' (' + (res.length - state.shown) + ')</button>');
    list.innerHTML = html.join('');
    if (ads) loadAds();
  }
  function loadAds() {
    if (!state.adsLoaded) {
      var s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CFG.ads.adsenseClient);
      document.head.appendChild(s);
      state.adsLoaded = true;
    }
    $all('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(function () {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* bloqueur de pub */ }
    });
  }

  /* ---------- Carte ---------- */
  function hasLeaflet() { return typeof window.L !== 'undefined' && window.L.map; }
  function initMap() {
    if (state.map || !hasLeaflet()) return;
    var mapEl = $('#map');
    if (!mapEl.offsetWidth) return;
    var tiles = CFG.tiles || {};
    var map = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([48.8566, 2.3522], 12);
    map.attributionControl.setPrefix('');
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(tiles.url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: tiles.maxZoom || 19, attribution: tiles.attribution || '&copy; OpenStreetMap'
    }).addTo(map);
    state.cluster = L.markerClusterGroup ? L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 48, chunkedLoading: true, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (c) {
        var n = c.getChildCount(), size = n < 10 ? 34 : n < 100 ? 40 : 46;
        return L.divIcon({ html: '<span>' + n + '</span>', className: 'cluster', iconSize: [size, size] });
      }
    }) : L.layerGroup();
    map.addLayer(state.cluster);
    state.map = map;
    renderMarkers();
    if (state.userPos) showMe();
  }
  function pinIcon(it) {
    var fav = state.favs.has(it.id), key = it.halal + (fav ? '-f' : '');
    if (!state.iconCache[key]) {
      state.iconCache[key] = L.divIcon({ className: 'pin pin-' + it.halal + (fav ? ' is-fav' : ''), iconSize: [22, 22] });
    }
    return state.iconCache[key];
  }
  function renderMarkers() {
    if (!state.map) return;
    state.cluster.clearLayers();
    var markers = state.results.map(function (it) {
      var m = L.marker([it.lat, it.lon], { icon: pinIcon(it), title: it.name, keyboard: true, riseOnHover: true });
      m.on('click', function () { openDetail(it.id); });
      return m;
    });
    if (state.cluster.addLayers) state.cluster.addLayers(markers);
    else markers.forEach(function (m) { state.cluster.addLayer(m); });
  }
  function showMe() {
    if (!state.map || !state.userPos) return;
    var ll = [state.userPos.lat, state.userPos.lon];
    if (!state.meMarker) {
      state.meMarker = L.marker(ll, { icon: L.divIcon({ className: 'me-dot', iconSize: [18, 18] }), title: t('geo.you'), interactive: false, zIndexOffset: 1000 }).addTo(state.map);
    } else state.meMarker.setLatLng(ll);
    state.map.setView(ll, 15);
  }

  /* ---------- Autour de moi ---------- */
  function locate() {
    if (!navigator.geolocation) { toast(t('toast.noGeo')); return; }
    toast(t('toast.locating'));
    navigator.geolocation.getCurrentPosition(function (p) {
      state.userPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      state.sort = 'distance';
      var sel = $('#sort');
      sel.querySelector('option[value="distance"]').disabled = false;
      sel.value = 'distance';
      $('#toast').hidden = true;
      applyFilters();
      showMe();
    }, function () { toast(t('toast.noGeo')); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ---------- Favoris ---------- */
  function toggleFav(id) {
    if (state.favs.has(id)) { state.favs.delete(id); toast(t('toast.favRemoved')); }
    else { state.favs.add(id); toast(t('toast.favAdded')); }
    store.set('favs', Array.from(state.favs));
    $all('[data-fav="' + CSS.escape(id) + '"]').forEach(function (b) {
      var on = state.favs.has(id);
      b.setAttribute('aria-pressed', on);
      b.setAttribute('aria-label', t(on ? 'aria.unfav' : 'aria.fav'));
    });
    if (state.filters.favOnly) applyFilters(); else renderMarkers();
  }

  /* ---------- Fiche restaurant ---------- */
  function yn(v) {
    if (v === true) return { cls: 'v-yes', txt: t('val.yes') };
    if (v === false) return { cls: 'v-no', txt: t('val.no') };
    if (v === 'yes') return { cls: 'v-yes', txt: t('val.yes') };
    if (v === 'limited') return { cls: 'v-limited', txt: t('val.limited') };
    if (v === 'no') return { cls: 'v-no', txt: t('val.no') };
    return { cls: 'v-unknown', txt: t('val.unknown') };
  }
  function weekHtml(it, now) {
    if (!it._week) {
      return it.oh ? '<p class="hint">' + esc(t('hours.raw', { v: it.oh })) + '</p>' : '<p class="hint">' + esc(t('status.unknown')) + '</p>';
    }
    var rows = [];
    for (var d = 0; d < 7; d++) {
      var spans = it._week[d].slice().sort(function (a, b) { return a[0] - b[0]; });
      var txt = spans.length ? spans.map(function (s) {
        return s[0] === 0 && s[1] >= 1440 ? '24 h/24' : H.fmt(s[0]) + '–' + H.fmt(s[1]);
      }).join(', ') : t('hours.closed');
      rows.push('<tr' + (d === now.day ? ' class="is-today"' : '') + '><td>' + esc(t('day.' + d)) + '</td><td>' + esc(txt) + '</td></tr>');
    }
    return '<table class="week"><tbody>' + rows.join('') + '</tbody></table>';
  }
  function addressOf(it) {
    var a = [it.addr, [it.cp, it.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return a || t('dep.' + it.dep);
  }
  function reportUrl(it) {
    if (configured(CFG.suggestFormUrl)) return CFG.suggestFormUrl;
    if (configured(CFG.contactEmail)) {
      return 'mailto:' + CFG.contactEmail + '?subject=' + encodeURIComponent('Tayyib : ' + (it ? it.name + ' (' + it.id + ')' : 'nouveau restaurant'));
    }
    return '';
  }
  function openDetail(id) {
    var it = state.byId.get(id);
    if (!it) return;
    var now = H.parisNow(), fav = state.favs.has(it.id), st = statusOf(it, now);
    var addr = addressOf(it);
    var q = encodeURIComponent(it.name + ', ' + addr);
    var routeUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + it.lat + ',' + it.lon;
    var googleUrl = 'https://www.google.com/maps/search/?api=1&query=' + q;
    var levelHelp = it.halal === 'certifie'
      ? (it.cert ? t('level.certifie.help', { cert: it.cert }) : t('level.certifie.helpNoCert'))
      : t('level.' + it.halal + '.help');
    var price = it.price ? t('price.' + it.price) + ' ' + t('price.perPerson') + (it.priceEst ? ' (' + t('price.est') + ')' : '') : t('price.unknown');
    var attrs = [
      ['attr.terrace', yn(it.terrace)], ['attr.takeaway', yn(it.takeaway)], ['attr.delivery', yn(it.delivery)],
      ['attr.reservation', yn(it.reservation)], ['attr.wheelchair', yn(it.wheelchair)], ['attr.alcohol', yn(it.alcohol)]
    ];
    var report = reportUrl(it);
    var actions = [
      extLink(routeUrl, t('detail.route'), 'route', 'act act-primary'),
      it.phone ? '<a class="act" href="tel:' + esc(it.phone.replace(/[^+\d]/g, '')) + '" data-ext>' + icon('phone') + '<span>' + esc(t('detail.call')) + '</span></a>' : '',
      it.website ? extLink(it.website, t('detail.website'), 'globe') : '',
      extLink(googleUrl, t('detail.google'), 'google'),
      '<button type="button" class="act" data-share="' + esc(it.id) + '">' + icon('share') + '<span>' + esc(t('detail.share')) + '</span></button>',
      '<button type="button" class="act" data-fav="' + esc(it.id) + '" aria-pressed="' + fav + '" aria-label="' + esc(t(fav ? 'aria.unfav' : 'aria.fav')) + '">' + icon('star') + '<span>' + esc(t('detail.fav')) + '</span></button>'
    ].join('');

    var dlg = $('#detail');
    dlg.innerHTML =
      '<div class="sheet-head"><h2 class="sheet-title">' + esc(it.name) + '</h2>' +
        '<button type="button" class="icon-btn" data-close aria-label="' + esc(t('aria.close')) + '">' + icon('close') + '</button></div>' +
      '<div class="sheet-body">' +
        '<div class="sec"><div class="d-sub">' + esc(it.cuisines.map(function (c) { return t('cuisine.' + c); }).join(', ')) +
          (it._d != null && state.userPos ? ' · ' + fmtDist(it._d) : '') + '</div>' +
          statusHtml(st) +
          '<p class="addr">' + icon('pin') + '<span>' + esc(addr) + '</span></p></div>' +
        '<div class="d-actions">' + actions + '</div>' +
        (configured(CFG.googlePlacesKey) ? '<div class="google" id="gRating">' + esc(t('detail.googleLoading')) + '</div>' : '') +
        '<div class="sec"><h3>' + esc(t('detail.halal')) + '</h3><div class="halal-box"><span class="lvl lvl-' + it.halal + '">' + esc(t('level.' + it.halal)) + '</span>' +
          (it.halalOnly ? '<strong>' + esc(t('halalOnly')) + '</strong>' : '') + '<p>' + esc(levelHelp) + '</p></div></div>' +
        '<div class="sec"><h3>' + esc(t('detail.info')) + '</h3><dl class="attrs">' +
          '<div><dt>' + esc(t('detail.price')) + '</dt><dd class="' + (it.price ? '' : 'v-unknown') + '">' + esc(price) + '</dd></div>' +
          attrs.map(function (a) { return '<div><dt>' + esc(t(a[0])) + '</dt><dd class="' + a[1].cls + '">' + esc(a[1].txt) + '</dd></div>'; }).join('') +
        '</dl></div>' +
        '<div class="sec"><h3>' + esc(t('detail.hours')) + '</h3>' + weekHtml(it, now) + '</div>' +
        '<div class="src">' + (it.manual ? '<span>' + esc(t('detail.manual')) + '</span>' : '<span>' + esc(t('detail.source')) + '</span>' +
          (it.osm ? extLink('https://www.openstreetmap.org/' + it.osm, t('detail.edit'), null, 'src-link') : '')) +
          (report ? (report.indexOf('mailto:') === 0
            ? '<a href="' + esc(report) + '" data-ext>' + esc(t('detail.report')) + '</a>'
            : extLink(report, t('detail.report'), null, 'src-link')) : '') +
        '</div>' +
      '</div>';
    if (!dlg.open) openSheet(dlg, '#r-' + it.id);
    dlg.querySelector('.sheet-body').scrollTop = 0;
    if (configured(CFG.googlePlacesKey)) loadGoogle(it);
  }

  var googleCache = new Map();
  function loadGoogle(it) {
    var box = function () { return document.getElementById('gRating'); };
    var show = function (g) {
      var el = box();
      if (!el) return;
      if (!g || g.rating == null) { el.hidden = true; return; }
      var full = Math.round(g.rating);
      el.innerHTML = '<span class="stars" aria-hidden="true">' + '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full) + '</span><span>' +
        esc(t('detail.googleRating', { r: g.rating.toLocaleString(state.lang === 'fr' ? 'fr-FR' : 'en-GB'), n: (g.count || 0).toLocaleString(state.lang === 'fr' ? 'fr-FR' : 'en-GB') })) + '</span>';
    };
    if (googleCache.has(it.id)) { show(googleCache.get(it.id)); return; }
    fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': CFG.googlePlacesKey, 'X-Goog-FieldMask': 'places.rating,places.userRatingCount' },
      body: JSON.stringify({ textQuery: it.name + ', ' + addressOf(it), maxResultCount: 1,
        locationBias: { circle: { center: { latitude: it.lat, longitude: it.lon }, radius: 200 } } })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var p = j && j.places && j.places[0];
      var g = p ? { rating: p.rating, count: p.userRatingCount } : null;
      googleCache.set(it.id, g);
      show(g);
    }).catch(function () { show(null); });
  }

  function share(id) {
    var it = state.byId.get(id);
    var base = configured(CFG.siteUrl) ? CFG.siteUrl : location.href.split('#')[0];
    var url = base + '#r-' + id;
    if (navigator.share && !IS_NATIVE) {
      navigator.share({ title: it ? it.name : 'Tayyib', text: it ? it.name + ' — Tayyib' : 'Tayyib', url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast(t('toast.copied')); }, function () { toast(url); });
    } else toast(url);
  }

  function openSheet(dlg, hash) {
    dlg.showModal();
    dlg.focus();
    try { history.pushState({ sheet: dlg.id }, '', hash || (location.pathname + location.search)); } catch (e) { /* ignore */ }
  }

  /* ---------- Feuille des filtres ---------- */
  function optBtn(group, value, label, count) {
    return '<button type="button" class="opt" data-g="' + group + '" data-v="' + esc(value) + '" aria-pressed="false">' + esc(label) +
      (count != null ? ' <small>' + count + '</small>' : '') + '</button>';
  }
  function switchRow(key, label) {
    return '<label class="switch"><span>' + esc(label) + '</span><input type="checkbox" id="sw-' + key + '" data-sw="' + key + '"></label>';
  }
  function buildFilterSheet() {
    var counts = {};
    state.items.forEach(function (it) { it.cuisines.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    var cuisines = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var depCounts = {}, levelCounts = {}, priceCounts = {};
    state.items.forEach(function (it) {
      depCounts[it.dep] = (depCounts[it.dep] || 0) + 1;
      levelCounts[it.halal] = (levelCounts[it.halal] || 0) + 1;
      if (it.price) priceCounts[it.price] = (priceCounts[it.price] || 0) + 1;
    });
    var dlg = $('#filters');
    dlg.innerHTML =
      '<div class="sheet-head"><h2 class="sheet-title">' + esc(t('filters.title')) + '</h2>' +
        '<button type="button" class="icon-btn" data-close aria-label="' + esc(t('aria.close')) + '">' + icon('close') + '</button></div>' +
      '<div class="sheet-body">' +
        '<div class="sec"><div class="switches">' + switchRow('openNow', t('filters.openNow')) + switchRow('favOnly', t('filters.favs')) + '</div></div>' +
        '<div class="sec"><h3>' + esc(t('filters.cuisine')) + '</h3><div class="opts">' +
          cuisines.map(function (c) { return optBtn('cuisines', c, t('cuisine.' + c), counts[c]); }).join('') + '</div></div>' +
        '<div class="sec"><h3>' + esc(t('filters.price')) + '</h3><div class="opts">' +
          PRICES.map(function (p) { return optBtn('prices', p, t('price.' + p), priceCounts[p] || 0); }).join('') + '</div></div>' +
        '<div class="sec"><h3>' + esc(t('filters.services')) + '</h3><div class="switches">' +
          switchRow('terrace', t('attr.terrace')) + switchRow('takeaway', t('attr.takeaway')) + switchRow('delivery', t('attr.delivery')) +
          switchRow('reservation', t('attr.reservation')) + switchRow('wheelchair', t('attr.wheelchair')) + '</div></div>' +
        '<div class="sec"><h3>' + esc(t('filters.alcohol')) + '</h3><div class="radios" role="radiogroup">' +
          ['any', 'no', 'yes'].map(function (v) {
            return '<label><input type="radio" name="alcohol" id="alc-' + v + '" value="' + v + '"><span>' + esc(t('alcohol.' + v)) + '</span></label>';
          }).join('') + '</div><p class="hint">' + esc(t('filters.alcoholHint')) + '</p></div>' +
        '<div class="sec"><h3>' + esc(t('filters.level')) + '</h3><div class="opts">' +
          LEVELS.map(function (l) { return optBtn('levels', l, t('level.' + l), levelCounts[l] || 0); }).join('') + '</div></div>' +
        '<div class="sec"><h3>' + esc(t('filters.dep')) + '</h3><div class="opts">' +
          DEPS.map(function (d) { return optBtn('deps', d, d + ' · ' + t('dep.' + d), depCounts[d] || 0); }).join('') + '</div></div>' +
      '</div>' +
      '<div class="sheet-foot"><button type="button" class="btn" data-freset>' + esc(t('filters.reset')) + '</button>' +
        '<button type="button" class="btn btn-primary" data-fapply></button></div>';
  }
  var draft = null;
  function cloneFilters(f) {
    var c = {};
    Object.keys(f).forEach(function (k) { c[k] = f[k] instanceof Set ? new Set(f[k]) : f[k]; });
    return c;
  }
  function syncFilterSheet() {
    var dlg = $('#filters');
    $all('.opt', dlg).forEach(function (b) { b.setAttribute('aria-pressed', draft[b.getAttribute('data-g')].has(b.getAttribute('data-v'))); });
    $all('[data-sw]', dlg).forEach(function (c) { c.checked = !!draft[c.getAttribute('data-sw')]; });
    $all('input[name="alcohol"]', dlg).forEach(function (r) { r.checked = r.value === draft.alcohol; });
    var n = filterItems(draft).length;
    $('[data-fapply]', dlg).textContent = n === 0 ? t('count.zero') : t('filters.show', { n: countLabel(n) });
  }
  function openFilters() {
    draft = cloneFilters(state.filters);
    var dlg = $('#filters');
    syncFilterSheet();
    openSheet(dlg);
  }

  /* ---------- Menu ---------- */
  function renderMenu() {
    var dlg = $('#menu');
    var updated = state.meta && state.meta.updated ? t('menu.dataText', { d: fmtDate(state.meta.updated) }) : t('menu.dataNone');
    var report = reportUrl(null);
    var install = '';
    if (!IS_NATIVE) {
      var parts = [];
      if (configured(CFG.apkUrl)) parts.push(extLink(CFG.apkUrl, t('menu.installApk'), 'download', 'btn btn-primary'));
      if (state.installEvt) parts.push('<button type="button" class="btn" data-pwa>' + icon('plus') + '<span>' + esc(t('menu.installPwa')) + '</span></button>');
      if (parts.length) install = '<div class="sec"><h3>' + esc(t('menu.install')) + '</h3><div class="copy-row">' + parts.join('') + '</div></div>';
    }
    dlg.innerHTML =
      '<div class="menu-hero"><span class="wordmark">Tayyib</span><span>' + esc(t('app.tagline')) + '</span>' +
        '<button type="button" class="icon-btn" data-close aria-label="' + esc(t('aria.close')) + '">' + icon('close') + '</button></div>' +
      '<div class="sheet-body">' +
        (configured(CFG.paypalDonateUrl) ? '<div class="sec"><h3>' + esc(t('menu.donate')) + '</h3><p>' + esc(t('menu.donateText')) + '</p>' +
          '<div>' + extLink(CFG.paypalDonateUrl, t('menu.donateBtn'), 'heart', 'btn btn-saffron') + '</div></div>' : '') +
        install +
        '<div class="sec"><h3>' + esc(t('menu.suggest')) + '</h3><p>' + esc(t('menu.suggestText')) + '</p>' +
          (report ? (report.indexOf('mailto:') === 0
            ? '<div class="copy-row"><code>' + esc(CFG.contactEmail) + '</code><button type="button" class="btn" data-copy="' + esc(CFG.contactEmail) + '">' + esc(t('copy')) + '</button></div>'
            : '<div>' + extLink(report, t('menu.suggestBtn'), 'plus', 'btn') + '</div>') : '') + '</div>' +
        '<div class="sec"><h3>' + esc(t('menu.prefs')) + '</h3>' +
          '<p class="hint">' + esc(t('menu.language')) + '</p><div class="radios">' +
            [['fr', 'Français'], ['en', 'English']].map(function (l) {
              return '<label><input type="radio" name="lang" id="lang-' + l[0] + '" value="' + l[0] + '"' + (state.lang === l[0] ? ' checked' : '') + '><span>' + l[1] + '</span></label>';
            }).join('') + '</div>' +
          '<p class="hint">' + esc(t('menu.theme')) + '</p><div class="radios">' +
            ['auto', 'light', 'dark'].map(function (v) {
              return '<label><input type="radio" name="theme" id="theme-' + v + '" value="' + v + '"' + (state.theme === v ? ' checked' : '') + '><span>' + esc(t('theme.' + v)) + '</span></label>';
            }).join('') + '</div></div>' +
        '<div class="sec"><h3>' + esc(t('menu.data')) + '</h3><p>' + esc(updated) + '</p><p class="hint">' + esc(t('menu.license')) + '</p></div>' +
        '<div class="legal-links">' + extLink(siteBase() + 'mentions-legales.html', t('menu.legal'), null, 'src-link') +
          extLink(siteBase() + 'confidentialite.html', t('menu.privacy'), null, 'src-link') + '</div>' +
      '</div>';
  }
  function siteBase() { return IS_NATIVE && configured(CFG.siteUrl) ? CFG.siteUrl : ''; }

  /* ---------- Vue carte / liste ---------- */
  function setView(v, auto) {
    state.view = v;
    if (!auto) store.set('view', v);
    $('#panes').setAttribute('data-view', v);
    $('#viewMap').setAttribute('aria-pressed', v === 'map');
    $('#viewList').setAttribute('aria-pressed', v === 'list');
    if (v === 'map' || window.matchMedia('(min-width: 960px)').matches) {
      requestAnimationFrame(function () { initMap(); if (state.map) state.map.invalidateSize(); });
    }
  }

  /* ---------- Événements ---------- */
  function bind() {
    var q = $('#q'), qClear = $('#qClear');
    var onSearch = debounce(function () { state.filters.q = q.value; applyFilters(); }, 140);
    q.addEventListener('input', function () { qClear.hidden = !q.value; onSearch(); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { q.blur(); if (state.view === 'map' && !window.matchMedia('(min-width: 960px)').matches) setView('list'); } });
    qClear.addEventListener('click', function () { q.value = ''; qClear.hidden = true; state.filters.q = ''; applyFilters(); q.focus(); });

    $('#viewMap').addEventListener('click', function () { setView('map'); });
    $('#viewList').addEventListener('click', function () { setView('list'); });
    $('#filtersBtn').addEventListener('click', openFilters);
    $('#menuBtn').addEventListener('click', function () { renderMenu(); openSheet($('#menu')); });
    $('#nearChip').addEventListener('click', locate);
    $('#mapLocate').addEventListener('click', locate);
    $('#sort').addEventListener('change', function (e) { state.sort = e.target.value; applyFilters(); $('#listPane').scrollTop = 0; });
    $('#chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-chip]');
      if (b) toggleChip(b.getAttribute('data-chip'));
    });

    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-open],[data-fav],[data-more],[data-reset],[data-dismiss],[data-share],[data-close],[data-copy],[data-pwa]');
      if (!el) return;
      if (el.hasAttribute('data-open')) openDetail(el.getAttribute('data-open'));
      else if (el.hasAttribute('data-fav')) toggleFav(el.getAttribute('data-fav'));
      else if (el.hasAttribute('data-more')) { state.shown += PAGE * 2; renderList(); }
      else if (el.hasAttribute('data-reset')) { state.filters = defaultFilters(); q.value = ''; qClear.hidden = true; applyFilters(); }
      else if (el.hasAttribute('data-dismiss')) { store.set(el.getAttribute('data-dismiss'), true); renderList(); }
      else if (el.hasAttribute('data-share')) share(el.getAttribute('data-share'));
      else if (el.hasAttribute('data-close')) { var d = el.closest('dialog'); if (d) d.close(); }
      else if (el.hasAttribute('data-copy')) {
        var txt = el.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast(t('toast.copied')); }, function () {});
      } else if (el.hasAttribute('data-pwa') && state.installEvt) {
        state.installEvt.prompt();
        state.installEvt = null;
        $('#menu').close();
      }
    });

    // Fermer une feuille en touchant le fond
    $all('dialog.sheet').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });
    // Bouton retour du téléphone : ferme la feuille ouverte au lieu de quitter l'appli
    $all('dialog.sheet').forEach(function (d) {
      d.addEventListener('close', function () {
        if (!d._popping && history.state && history.state.sheet === d.id) { try { history.back(); } catch (e) { /* ignore */ } }
        d._popping = false;
      });
    });
    window.addEventListener('popstate', function () {
      $all('dialog.sheet[open]').forEach(function (d) { d._popping = true; d.close(); });
    });

    // Feuille des filtres : brouillon appliqué au clic sur « Voir »
    var fd = $('#filters');
    fd.addEventListener('click', function (e) {
      var o = e.target.closest('.opt');
      if (o) {
        var set = draft[o.getAttribute('data-g')], v = o.getAttribute('data-v');
        if (set.has(v)) set.delete(v); else set.add(v);
        syncFilterSheet();
      } else if (e.target.closest('[data-freset]')) {
        var keep = draft.q; draft = defaultFilters(); draft.q = keep; syncFilterSheet();
      } else if (e.target.closest('[data-fapply]')) {
        state.filters = draft; fd.close(); applyFilters();
      }
    });
    fd.addEventListener('change', function (e) {
      var sw = e.target.getAttribute('data-sw');
      if (sw) draft[sw] = e.target.checked;
      if (e.target.name === 'alcohol') draft.alcohol = e.target.value;
      syncFilterSheet();
    });

    // Menu : langue et thème
    $('#menu').addEventListener('change', function (e) {
      if (e.target.name === 'lang') {
        state.lang = e.target.value; store.set('lang', state.lang);
        applyI18n(); buildFilterSheet(); applyFilters(); renderMenu();
      } else if (e.target.name === 'theme') {
        state.theme = e.target.value; store.set('theme', state.theme); applyTheme();
      }
    });

    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); state.installEvt = e; });
    window.addEventListener('resize', debounce(function () { if (window.matchMedia('(min-width: 960px)').matches) initMap(); if (state.map) state.map.invalidateSize(); }, 200));
    window.addEventListener('hashchange', openFromHash);
    // Rafraîchir « ouvert maintenant » chaque minute
    setInterval(function () { if (!document.hidden && state.items.length) { var top = $('#listPane').scrollTop; renderList(); $('#listPane').scrollTop = top; } }, 60000);
  }

  function openFromHash() {
    var m = /^#r-([nwr]\d+|[\w-]+)$/.exec(location.hash);
    if (m && state.byId.has(m[1])) openDetail(m[1]);
  }

  /* ---------- Démarrage ---------- */
  function start() {
    applyTheme();
    applyI18n();
    bind();
    setView(window.matchMedia('(min-width: 960px)').matches ? 'list' : state.view, true);
    renderList();
    loadData().then(function () {
      initMap();
      openFromHash();
    });
    if ('serviceWorker' in navigator && !IS_NATIVE && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* hors ligne indisponible */ });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
