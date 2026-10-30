// Reine Hilfsfunktionen (ohne Firebase) – Zeitzone, Texte, iCal
const TZ = 'Europe/Zurich';
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const TYPE_LABEL = { L: 'Mittagessen', D: 'Abendessen' };

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
function zurichParts(ms) {
  const p = {};
  for (const x of dtf.formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}
// Differenz Zürich-Ortszeit minus UTC zum Zeitpunkt ms
function tzOffsetMs(ms) {
  const s = Math.floor(ms / 1000) * 1000;
  const p = zurichParts(s);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - s;
}
// 'YYYY-MM-DD' + 'HH:MM' in Zürich → UTC-Millisekunden
function zurichToUtc(dateKey, time) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ts = guess - tzOffsetMs(guess);
  ts = guess - tzOffsetMs(ts);
  return ts;
}
// UTC-Millisekunden → 'YYYY-MM-DD' in Zürich
function zurichDateKey(ms) {
  const p = zurichParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
function dayInfo(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { weekday: DAYS[wd], day: d, month: MONTHS[m - 1] };
}
// «Freitag, 30. Okt. · Abendessen um 19:00 Uhr»
function mealLabel(dateKey, type, time) {
  const i = dayInfo(dateKey);
  return `${i.weekday}, ${i.day}. ${i.month} · ${TYPE_LABEL[type]} um ${time} Uhr`;
}
// «Fr 30. Okt. Abendessen»
function shortLabel(dateKey, type) {
  const i = dayInfo(dateKey);
  return `${i.weekday.slice(0, 2)} ${i.day}. ${i.month} ${TYPE_LABEL[type]}`;
}

/* ---------- iCal ---------- */
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
// Zeilen nach 75 Bytes falten (RFC 5545)
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (curLen + len > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
      limit = 74; // Folgezeilen beginnen mit einem Leerzeichen
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function buildIcs(events, calName) {
  const now = icsDate(Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Essensplan//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
    `X-WR-TIMEZONE:${TZ}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M'
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(e.uid)}`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${icsDate(e.updated || Date.now())}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { zurichToUtc, zurichDateKey, mealLabel, shortLabel, buildIcs, icsEscape, fold, TYPE_LABEL };
