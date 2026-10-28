// node tests/test_hours.js
const H = require('../www/hours.js');
const assert = require('assert');

const cases = [
  ['Mo-Su 11:00-23:00', w => w.every(d => d.length === 1 && d[0][0] === 660 && d[0][1] === 1380)],
  ['24/7', w => w.every(d => d[0][0] === 0 && d[0][1] === 1440)],
  ['Mo-Fr 11:30-14:30,18:30-23:00; Sa,Su 12:00-00:00', w => w[0].length === 2 && w[5][0][1] === 1440],
  ['Mo-Th 11:00-01:00; Fr-Sa 11:00-03:00; Su off', w => w[4][0][1] === 1620 && w[6].length === 0],
  ['Mo-Su 11:00-23:00; Fr 11:00-12:30,14:00-23:00', w => w[4].length === 2 && w[3].length === 1],
  ['Mo-Fr 10:00-20:00, Sa 10:00-14:00', w => w[5][0][1] === 840 && w[6].length === 0],
  ['Mo-Su 11:00-23:00; PH off', w => w[6].length === 1],
  ['11:00-22:00', w => w.every(d => d.length === 1)],
  ['Tu-Su 18:00+', w => w[0].length === 0 && w[1][0][1] === 1440],
  ['Su-Tu 12:00-15:00', w => w[6].length && w[0].length && w[1].length && !w[2].length],
];
for (const [s, check] of cases) {
  const w = H.parse(s);
  assert.ok(w, 'non lu : ' + s);
  assert.ok(check(w), 'mauvais résultat : ' + s + ' → ' + JSON.stringify(w));
}
for (const bad of ['Jan-Mar Mo-Fr 10:00-18:00', 'sunrise-sunset', 'Mo-Fr', '', 'variable']) {
  assert.strictEqual(H.parse(bad), null, 'devrait être inconnu : ' + bad);
}
// Statut
const w = H.parse('Mo-Th 11:00-01:00; Fr-Sa 11:00-03:00; Su off');
assert.deepStrictEqual(H.status(w, { day: 1, min: 30 }), { open: true, until: 60 }); // mardi 00:30 (débord du lundi)
assert.strictEqual(H.status(w, { day: 6, min: 120 }).open, true);  // dimanche 02:00 (débord du samedi)
assert.strictEqual(H.status(w, { day: 6, min: 600 }).open, false); // dimanche 10:00
assert.strictEqual(H.status(w, { day: 6, min: 600 }).next.day, 0); // rouvre lundi
const s = H.status(H.parse('Mo-Su 11:00-23:00'), { day: 2, min: 700 });
assert.strictEqual(s.open, true); assert.strictEqual(s.until, 1380);
const s2 = H.status(H.parse('Mo-Su 11:00-23:00'), { day: 2, min: 1400 });
assert.strictEqual(s2.open, false); assert.strictEqual(s2.next.day, 3); assert.strictEqual(s2.next.min, 660);
const s3 = H.status(H.parse('24/7'), { day: 2, min: 1400 });
assert.strictEqual(s3.open, true); assert.strictEqual(s3.allDay, true);
const now = H.parisNow(new Date('2026-10-28T13:15:00Z'));
assert.deepStrictEqual(now, { day: 2, min: 14 * 60 + 15 }); // mercredi 14:15 à Paris (UTC+1)
console.log('Horaires : ' + (cases.length + 12) + ' vérifications OK');
