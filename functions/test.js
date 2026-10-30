// Kleine Selbsttests für die Hilfsfunktionen: `npm test`
const assert = require('assert');
const { zurichToUtc, zurichDateKey, mealLabel, shortLabel, buildIcs, fold } = require('./lib');

// Winterzeit (UTC+1) und Sommerzeit (UTC+2)
assert.strictEqual(new Date(zurichToUtc('2026-10-30', '19:00')).toISOString(), '2026-10-30T18:00:00.000Z');
assert.strictEqual(new Date(zurichToUtc('2026-07-01', '12:15')).toISOString(), '2026-07-01T10:15:00.000Z');
// Tag der Zeitumstellung (25.10.2026, 03:00 → 02:00)
assert.strictEqual(new Date(zurichToUtc('2026-10-25', '19:00')).toISOString(), '2026-10-25T18:00:00.000Z');
assert.strictEqual(new Date(zurichToUtc('2026-03-29', '12:15')).toISOString(), '2026-03-29T10:15:00.000Z');

// Datum in Zürich kurz vor/nach Mitternacht UTC
assert.strictEqual(zurichDateKey(Date.parse('2026-10-30T23:30:00Z')), '2026-10-31');
assert.strictEqual(zurichDateKey(Date.parse('2026-10-30T22:59:00Z')), '2026-10-30');

assert.strictEqual(mealLabel('2026-10-30', 'D', '19:00'), 'Freitag, 30. Okt. · Abendessen um 19:00 Uhr');
assert.strictEqual(shortLabel('2026-11-01', 'L'), 'So 1. Nov. Mittagessen');

// Zeilen falten: keine Zeile über 75 Bytes, Inhalt bleibt gleich
const long = 'DESCRIPTION:' + 'Älplermagronen mit Apfelmus, '.repeat(8);
const folded = fold(long);
for (const l of folded.split('\r\n')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, 'Zeile zu lang');
assert.strictEqual(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long);

const ics = buildIcs([{ uid: 'a@b', start: zurichToUtc('2026-10-30', '19:00'), end: zurichToUtc('2026-10-30', '20:30'), summary: 'Kochen: Abendessen – Risotto; mit Pilzen', description: 'Es kocht: Mia\nEs essen (2): Mia, Jonas' }], 'Essensplan');
assert.ok(ics.includes('DTSTART:20261030T180000Z'));
assert.ok(ics.includes('SUMMARY:Kochen: Abendessen – Risotto\\; mit Pilzen'));
assert.ok(ics.includes('DESCRIPTION:Es kocht: Mia\\nEs essen (2): Mia\\, Jonas'));
assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));

console.log('Alle Tests bestanden ✔');
