import fs from 'fs';
import { DxfReader, DwgWriter, DwgReader, ACadVersion, MText, XYZ } from '@node-projects/acad-ts';
const [,, inp, out] = process.argv;
const b = fs.readFileSync(inp);
const notes = [];
const doc = DxfReader.readFromStream(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), (s, e) => notes.push(e.message));
doc.header.version = ACadVersion.AC1032;
// Le DXF R2007+ est en UTF-8 : on corrige les textes décodés à tort en Windows-1252
const cp1252 = new Map([[0x20AC,0x80],[0x201A,0x82],[0x192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x2C6,0x88],[0x2030,0x89],[0x160,0x8A],[0x2039,0x8B],[0x152,0x8C],[0x17D,0x8E],[0x2018,0x91],[0x2019,0x92],[0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x2DC,0x98],[0x2122,0x99],[0x161,0x9A],[0x203A,0x9B],[0x153,0x9C],[0x17E,0x9E],[0x178,0x9F]]);
const fix = s => { if (!/[\u0080-ÿ]/.test(s)) return s; try { const bytes = Uint8Array.from([...s].map(ch => { const c = ch.codePointAt(0); const v = cp1252.get(c) ?? c; if (v > 255) throw new Error('not cp1252'); return v; })); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return s; } };
for (const e of doc.modelSpace.entities) if (typeof e.value === 'string') e.value = fix(e.value);
// MTEXT sans direction (code 11 absent du DXF) : acad-ts écrirait un vecteur nul,
// et Autodesk Viewer afficherait le texte écrasé (cas du texte des cotes horizontales).
let mfix = 0;
const fixMText = e => { if (e instanceof MText) { const a = e.alignmentPoint; if (!a || Math.hypot(a.x, a.y, a.z) < 1e-9) { e.alignmentPoint = new XYZ(1, 0, 0); mfix++; } if (typeof e.value === 'string') e.value = fix(e.value); } };
for (const e of doc.modelSpace.entities) fixMText(e);
for (const br of doc.blockRecords) for (const e of br.entities) fixMText(e);
// styles de cote : suffixe et flèches perdus à la lecture du DXF
for (const ds of doc.dimensionStyles) {
  if (ds.name === 'COTES_M') {
    ds.postFix = '<> m';
    try { ds.arrowBlock = doc.blockRecords.get('_ARCHTICK'); } catch { /* bloc absent */ }
  }
}
console.log('MTEXT corrigés :', mfix);
const count = d => { const c = {}; for (const e of d.modelSpace.entities) c[e.constructor.name] = (c[e.constructor.name] || 0) + 1; return c; };
console.log('DXF  :', JSON.stringify(count(doc)));
fs.writeFileSync(out, DwgWriter.writeToBuffer(doc));
const r = fs.readFileSync(out);
const back = DwgReader.readFromStream(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength), (s, e) => {});
console.log('DWG  :', JSON.stringify(count(back)), 'version', back.header.version, 'calques', [...back.layers].map(l => l.name).join(','));
console.log('textes', [...back.modelSpace.entities].filter(e=>typeof e.value==='string').slice(0,4).map(e=>e.value));
console.log('unités', back.header.insUnits ?? back.header.insunits, r.length, 'octets');
if (notes.length) console.log('notes lecture DXF:', [...new Set(notes)].slice(0, 10));
