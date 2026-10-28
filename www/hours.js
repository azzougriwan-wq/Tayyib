/* Lecture des horaires au format OpenStreetMap (opening_hours).
   Gère les cas courants : jours (Mo-Fr, Sa,Su), plages multiples, passage de minuit,
   24/7, off/closed. Les règles de jours fériés (PH) sont ignorées.
   Renvoie null quand le format n'est pas reconnu : l'appli affiche alors le texte brut. */
(function (root) {
  'use strict';
  var DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?';
  var SEL_RE = new RegExp('^(' + DAY_RE + '(?:\\s*,\\s*' + DAY_RE + ')*)(?:\\s+|$)(.*)$');

  function parseTime(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 48 || mi > 59) return null;
    return h * 60 + mi;
  }

  function parseDays(sel) {
    var out = [], parts = sel.split(','), sawHoliday = false;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p === 'PH' || p === 'SH') { sawHoliday = true; continue; }
      var r = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(p);
      if (!r) return null;
      var a = DAYS.indexOf(r[1]), b = r[2] ? DAYS.indexOf(r[2]) : a;
      for (var d = a, n = 0; n < 7; d = (d + 1) % 7, n++) {
        if (out.indexOf(d) < 0) out.push(d);
        if (d === b) break;
      }
    }
    if (!out.length && sawHoliday) return 'holiday';
    return out;
  }

  function parseTimes(s) {
    s = s.replace(/"[^"]*"/g, '').trim();
    if (!s) return null;
    if (/^(off|closed)$/i.test(s)) return [];
    if (s === '24/7') return [[0, 1440]];
    var spans = s.split(/\s*,\s*/), out = [];
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i].trim();
      var open = /^(\d{1,2}:\d{2})\+$/.exec(sp);
      if (open) { var st = parseTime(open[1]); if (st == null) return null; out.push([st, 1440]); continue; }
      var m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?$/.exec(sp);
      if (!m) return null;
      var a = parseTime(m[1]), b = parseTime(m[2]);
      if (a == null || b == null) return null;
      if (b <= a) b += 1440;
      out.push([a, b]);
    }
    return out;
  }

  /** Renvoie un tableau de 7 jours (lundi = 0) de plages [début, fin] en minutes, ou null. */
  function parse(value) {
    if (!value || typeof value !== 'string') return null;
    var v = value.trim();
    if (!v) return null;
    if (v === '24/7') return [0, 1, 2, 3, 4, 5, 6].map(function () { return [[0, 1440]]; });
    var week = [null, null, null, null, null, null, null];
    var rules = v.split(/\s*(?:;|\|\|)\s*/);
    var expanded = [];
    rules.forEach(function (r) {
      // « Mo-Fr 10:00-20:00, Sa 10:00-14:00 » : virgule suivie d'un jour = règle additionnelle
      r.split(/(?:(?<=\d)|(?<=off)|(?<=closed))\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/).forEach(function (x) {
        if (x.trim()) expanded.push(x.trim());
      });
    });
    var any = false;
    for (var i = 0; i < expanded.length; i++) {
      var rule = expanded[i], days, rest;
      var m = SEL_RE.exec(rule);
      if (m) {
        days = parseDays(m[1]);
        rest = m[2];
        if (days === null) return null;
        if (days === 'holiday') continue;
      } else if (/^\d/.test(rule) || /^(off|closed|24\/7)$/i.test(rule)) {
        days = [0, 1, 2, 3, 4, 5, 6];
        rest = rule;
      } else {
        return null;
      }
      var times = parseTimes(rest);
      if (times === null) return null;
      days.forEach(function (d) { week[d] = times; });
      any = true;
    }
    if (!any) return null;
    return week.map(function (d) { return d || []; });
  }

  /** Jour (lundi = 0) et minutes, heure de Paris. */
  function parisNow(date) {
    var d = date || new Date();
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    var get = function (t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value; };
    var wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
    return { day: wd, min: (+get('hour') % 24) * 60 + (+get('minute')) };
  }

  /** {open, until} si ouvert, {open:false, next:{day,min}} sinon, null si horaires inconnus. */
  function status(week, now) {
    if (!week) return null;
    var day = now.day, min = now.min;
    var today = week[day], prev = week[(day + 6) % 7];
    for (var i = 0; i < prev.length; i++) {
      if (prev[i][1] > 1440 && min < prev[i][1] - 1440) return { open: true, until: prev[i][1] - 1440 };
    }
    for (var j = 0; j < today.length; j++) {
      if (min >= today[j][0] && min < today[j][1]) {
        return { open: true, until: today[j][1] >= 1440 && today[j][1] - 1440 === 0 && today[j][0] === 0 ? null : today[j][1] % 1440, allDay: today[j][0] === 0 && today[j][1] >= 1440 };
      }
    }
    for (var k = 0; k < 8; k++) {
      var dd = (day + k) % 7, spans = week[dd].slice().sort(function (a, b) { return a[0] - b[0]; });
      for (var s = 0; s < spans.length; s++) {
        if (k === 0 && spans[s][0] <= min) continue;
        return { open: false, next: { day: dd, min: spans[s][0], inDays: k } };
      }
    }
    return { open: false, next: null };
  }

  function fmt(min) {
    var m = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  var api = { parse: parse, status: status, parisNow: parisNow, fmt: fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TayyibHours = api;
})(this);
