// Essensplan – Backend (Cloud Functions for Firebase, 2nd gen)
const { setGlobalOptions } = require('firebase-functions/v2');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const nodemailer = require('nodemailer');
const { zurichToUtc, zurichDateKey, mealLabel, shortLabel, buildIcs, TYPE_LABEL } = require('./lib');

initializeApp();
const db = getFirestore();

/* ---------- Einstellungen ---------- */
const REGION = 'europe-west6';            // Zürich – muss zum Firestore-Standort passen
const GMAIL_USER = 'hufristv@gmail.com';
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const MAX_EMAILS_PER_DAY = 80;            // Sicherheitsgrenze
const DEBOUNCE_MS = 5 * 60 * 1000;        // 5 Minuten Wartezeit (Fehlklicks)
const MAX_DEBOUNCE_MS = 30 * 60 * 1000;   // spätestens nach 30 Minuten senden
const REMINDER_WINDOW_MS = 30 * 60 * 1000;
const PROJECT_ID = process.env.GCLOUD_PROJECT || (JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId);
const APP_URL = `https://${PROJECT_ID}.web.app`;

// maxInstances: 1 → selbst bei einem Fehler kann nie mehr als eine Instanz gleichzeitig laufen
setGlobalOptions({ region: REGION, maxInstances: 1, memory: '256MiB', timeoutSeconds: 60 });

/* ---------- E-Mail ---------- */
let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.value().replace(/\s+/g, '') }
    });
  }
  return transporter;
}

async function sendMail(to, subject, text) {
  const ref = db.doc(`meta/mailcount_${zurichDateKey(Date.now())}`);
  const allowed = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const n = s.exists ? (s.data().n || 0) : 0;
    if (n >= MAX_EMAILS_PER_DAY) return false;
    tx.set(ref, { n: n + 1 });
    return true;
  });
  if (!allowed) {
    logger.warn('Tageslimit für E-Mails erreicht – nicht gesendet', { to, subject });
    return false;
  }
  await getTransporter().sendMail({
    from: `"Essensplan" <${GMAIL_USER}>`,
    to,
    subject,
    text: `${text}\n\n—\nEssensplan: ${APP_URL}\nEinstellungen: oben rechts auf deinen Namen tippen.`
  });
  logger.info('E-Mail gesendet', { to, subject });
  return true;
}

async function loadUsers(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return {};
  const snaps = await db.getAll(...unique.map((id) => db.doc(`users/${id}`)));
  const out = {};
  snaps.forEach((s) => { if (s.exists) out[s.id] = { id: s.id, ...s.data() }; });
  return out;
}

const timeOf = (m) => m.time || (m.type === 'L' ? '12:15' : '19:00');
const ids = (list) => new Set((list || []).map((e) => e.id));
function personLabel(e, users) {
  if (e.kind === 'plus') {
    const by = (users && users[e.by] && users[e.by].name) || e.byName || '?';
    return `${e.name} (Gast von ${by})`;
  }
  if (e.kind === 'guest') return `${e.name} (Gast)`;
  return (users && users[e.id] && users[e.id].name) || e.name;
}
function signature(m) {
  if (!m) return '[]|[]';
  const c = (m.cooks || []).map((e) => e.id).sort().join(',');
  const e = (m.eaters || []).map((x) => x.id).sort().join(',');
  return `${c}|${e}`;
}

/* ---------- 1) Änderungen merken (Wartezeit 5 Minuten) ---------- */
exports.onMealWrite = onDocumentWritten('meals/{mealId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  if (signature(before) === signature(after)) return;            // nur Zeit/Menü geändert
  if (zurichToUtc(after.date, timeOf(after)) <= Date.now()) return; // vorbei

  const mealId = event.params.mealId;
  const ref = db.doc(`checks/${mealId}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) {
      tx.set(ref, {
        mealId,
        baseline: { cooks: (before && before.cooks) || [], eaters: (before && before.eaters) || [] },
        firstChangeAt: now,
        dueAt: now + DEBOUNCE_MS
      });
    } else {
      const first = s.data().firstChangeAt || now;
      tx.update(ref, { dueAt: Math.min(now + DEBOUNCE_MS, first + MAX_DEBOUNCE_MS) });
    }
  });
});

/* ---------- 2) Jede Minute: Warnungen + Erinnerungen ---------- */
exports.minuteJob = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Europe/Zurich',
  secrets: [GMAIL_APP_PASSWORD],
  retryCount: 0
}, async () => {
  await processChecks();
  await processReminders();
});

async function processChecks() {
  const now = Date.now();
  const snap = await db.collection('checks').where('dueAt', '<=', now).limit(25).get();
  for (const c of snap.docs) {
    try { await handleCheck(c.data()); }
    catch (e) { logger.error('Warnung fehlgeschlagen', e); }
    await c.ref.delete();
  }
}

async function handleCheck(chk) {
  const ms = await db.doc(`meals/${chk.mealId}`).get();
  if (!ms.exists) return;
  const meal = ms.data();
  if (meal.hidden) return;
  if (zurichToUtc(meal.date, timeOf(meal)) <= Date.now()) return;

  const bCooks = chk.baseline.cooks || [];
  const bEaters = chk.baseline.eaters || [];
  const cCooks = meal.cooks || [];
  const cEaters = meal.eaters || [];
  const label = mealLabel(meal.date, meal.type, timeOf(meal));
  const short = shortLabel(meal.date, meal.type);

  const allUserIds = [...cCooks, ...cEaters, ...bCooks, ...bEaters]
    .flatMap((e) => (e.kind === 'plus' ? [e.by] : [e.id]));
  const users = await loadUsers(allUserIds);

  // a) Esser warnen: es kochte jemand, jetzt niemand mehr
  if (bCooks.length > 0 && cCooks.length === 0) {
    const formerCooks = ids(bCooks);
    const left = bCooks.map((e) => personLabel(e, users)).join(', ');
    for (const e of cEaters) {
      if (e.kind !== 'user' || formerCooks.has(e.id)) continue;
      const u = users[e.id];
      if (!u || !u.email) continue;
      await sendMail(u.email, `Niemand kocht mehr: ${short}`,
        `Hallo ${u.name}\n\n${left} kocht nicht mehr für ${label}.\nIm Moment ist niemand als Koch eingetragen – du stehst aber auf der Esser-Liste.\n\nVielleicht möchtest du selbst kochen oder dich austragen.`);
    }
  }

  // b) Köche warnen: Esser-Liste hat sich geändert
  const be = ids(bEaters);
  const ce = ids(cEaters);
  const joined = cEaters.filter((e) => !be.has(e.id));
  const left = bEaters.filter((e) => !ce.has(e.id));
  if (joined.length || left.length) {
    for (const c of cCooks) {
      if (c.kind !== 'user') continue;
      if ((c.since || 0) > chk.firstChangeAt - DEBOUNCE_MS) continue; // Koch hat sich gerade erst eingetragen
      const u = users[c.id];
      if (!u || !u.email) continue;
      const j = joined.filter((e) => e.id !== c.id);
      const l = left.filter((e) => e.id !== c.id);
      if (!j.length && !l.length) continue;
      const lines = [];
      if (j.length) lines.push(`Neu dabei: ${j.map((e) => personLabel(e, users)).join(', ')}`);
      if (l.length) lines.push(`Abgemeldet: ${l.map((e) => personLabel(e, users)).join(', ')}`);
      const all = cEaters.map((e) => personLabel(e, users));
      await sendMail(u.email, `Änderung bei den Essern: ${short}`,
        `Hallo ${u.name}\n\nDu kochst ${label}. Die Esser-Liste hat sich geändert:\n\n${lines.join('\n')}\n\nJetzt essen ${all.length} Person${all.length === 1 ? '' : 'en'}: ${all.join(', ') || 'niemand'}`);
    }
  }
}

async function processReminders() {
  const now = Date.now();
  const today = zurichDateKey(now);
  const tomorrow = zurichDateKey(now + 24 * 3600 * 1000);
  const snap = await db.collection('meals').where('date', '>=', today).where('date', '<=', tomorrow).get();

  const jobs = [];
  snap.forEach((d) => {
    const m = d.data();
    if (m.hidden) return;
    const at = zurichToUtc(m.date, timeOf(m));
    const cookIds = new Set((m.cooks || []).filter((e) => e.kind === 'user').map((e) => e.id));
    const cookAt = at - 2 * 3600 * 1000;
    const eatAt = at - 1 * 3600 * 1000;
    if (now >= cookAt && now < cookAt + REMINDER_WINDOW_MS) {
      cookIds.forEach((uid) => jobs.push({ mealId: d.id, meal: m, role: 'cook', uid }));
    }
    if (now >= eatAt && now < eatAt + REMINDER_WINDOW_MS) {
      (m.eaters || []).filter((e) => e.kind === 'user' && !cookIds.has(e.id))
        .forEach((e) => jobs.push({ mealId: d.id, meal: m, role: 'eat', uid: e.id }));
    }
  });
  if (!jobs.length) return;

  const users = await loadUsers(jobs.flatMap((j) => [j.uid, ...(j.meal.cooks || []).map((e) => e.id), ...(j.meal.eaters || []).map((e) => (e.kind === 'plus' ? e.by : e.id))]));
  for (const job of jobs) {
    const u = users[job.uid];
    if (!u || !u.email) continue;
    if (job.role === 'cook' && !u.remCook) continue;
    if (job.role === 'eat' && !u.remEat) continue;
    const sentRef = db.doc(`sent/${job.mealId}_${job.role}_${job.uid}`);
    try { await sentRef.create({ at: now }); } catch { continue; } // schon gesendet
    const m = job.meal;
    const label = mealLabel(m.date, m.type, timeOf(m));
    const eaters = (m.eaters || []).map((e) => personLabel(e, users));
    const cooks = (m.cooks || []).map((e) => personLabel(e, users));
    const menu = (m.menu || '').trim();
    if (job.role === 'cook') {
      await sendMail(u.email, `Erinnerung: Du kochst ${TYPE_LABEL[m.type]} um ${timeOf(m)}`,
        `Hallo ${u.name}\n\nDu kochst ${label}.\n${menu ? `Es gibt: ${menu}\n` : ''}\nEs essen ${eaters.length} Person${eaters.length === 1 ? '' : 'en'}: ${eaters.join(', ')}`);
    } else {
      await sendMail(u.email, `Erinnerung: ${TYPE_LABEL[m.type]} um ${timeOf(m)}`,
        `Hallo ${u.name}\n\nDu bist eingetragen für ${label}.\n${cooks.length ? `Es kocht: ${cooks.join(', ')}` : 'Achtung: Im Moment kocht niemand!'}\n${menu ? `Es gibt: ${menu}\n` : ''}`);
    }
  }
}

/* ---------- 3) Kalender-Abo (iCal) ---------- */
exports.calendar = onRequest(async (req, res) => {
  const match = (req.path || '').match(/([A-Za-z0-9]{16,64})\.ics$/);
  if (!match) { res.status(404).send('Nicht gefunden'); return; }
  const us = await db.collection('users').where('calToken', '==', match[1]).limit(1).get();
  if (us.empty) { res.status(404).send('Nicht gefunden'); return; }
  const uid = us.docs[0].id;

  const ms = await db.collection('meals').where('participants', 'array-contains', uid).get();
  const fromKey = zurichDateKey(Date.now() - 60 * 24 * 3600 * 1000);
  const meals = [];
  const userIds = [];
  ms.forEach((d) => {
    const m = d.data();
    if (m.hidden || m.date < fromKey) return;
    meals.push({ id: d.id, ...m });
    (m.cooks || []).forEach((e) => userIds.push(e.id));
    (m.eaters || []).forEach((e) => userIds.push(e.kind === 'plus' ? e.by : e.id));
  });
  const users = await loadUsers(userIds);

  const events = [];
  for (const m of meals) {
    const isCook = (m.cooks || []).some((e) => e.id === uid);
    const isEater = (m.eaters || []).some((e) => e.id === uid);
    if (!isCook && !isEater) continue;
    const start = zurichToUtc(m.date, timeOf(m));
    const menu = (m.menu || '').trim();
    const cooks = (m.cooks || []).map((e) => personLabel(e, users));
    const eaters = (m.eaters || []).map((e) => personLabel(e, users));
    events.push({
      uid: `${m.id}-${uid}@essensplan`,
      start,
      end: start + 90 * 60 * 1000,
      summary: `${isCook ? 'Kochen' : 'Essen'}: ${TYPE_LABEL[m.type]}${menu ? ` – ${menu}` : ''}`,
      description: `${cooks.length ? `Es kocht: ${cooks.join(', ')}` : 'Niemand kocht bisher!'}\nEs essen (${eaters.length}): ${eaters.join(', ')}\n\n${APP_URL}`,
      updated: m.updatedAt || Date.now()
    });
  }

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.send(buildIcs(events, 'Essensplan'));
});

/* ---------- 4) Notbremse: Abrechnung abschalten, wenn das Budget erreicht ist ---------- */
exports.stopBillingAtBudget = onMessagePublished('budget-alerts', async (event) => {
  const data = event.data.message.json || {};
  logger.info('Budget-Meldung', data);
  if (typeof data.costAmount !== 'number' || typeof data.budgetAmount !== 'number') return;
  if (data.costAmount < data.budgetAmount) return;

  const { CloudBillingClient } = require('@google-cloud/billing');
  const billing = new CloudBillingClient();
  const name = `projects/${PROJECT_ID}`;
  const [info] = await billing.getProjectBillingInfo({ name });
  if (!info.billingEnabled) { logger.info('Abrechnung ist bereits aus.'); return; }
  await billing.updateProjectBillingInfo({ name, projectBillingInfo: { billingAccountName: '' } });
  logger.warn(`Budget erreicht (${data.costAmount} von ${data.budgetAmount}) – Abrechnung für ${PROJECT_ID} abgeschaltet.`);
});
