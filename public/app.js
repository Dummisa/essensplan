// Essensplan – Frontend
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, query, where, runTransaction, addDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ---------- Konstanten ---------- */
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const DEFAULT_TIME = { L: '12:15', D: '19:00' };
const TYPE_LABEL = { L: 'Mittagessen', D: 'Abendessen' };
const LS_USER = 'essensplan.userId';
const LS_GUEST = 'essensplan.guest';

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => (n < 10 ? '0' : '') + n;
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const mealAt = (dateKey, time) => { const d = parseKey(dateKey); const [h, mi] = time.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi); };
const randId = (len = 20) => {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => a[b % a.length]).join('');
};
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y) / 86400000 + 1) / 7);
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };
const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/* ---------- Icons ---------- */
const svg = (inner, size = 20, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  chef: '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/>',
  fork: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pot: '<path d="M3 11h18"/><path d="M5 11v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-6"/><path d="M9 7c0-1 1-1.5 1-2.5S9 3 9 3"/><path d="M14 7c0-1 1-1.5 1-2.5S14 3 14 3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>'
};
const MINUS = '<svg class="minus" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><line x1="5" y1="17" x2="29" y2="17" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';

/* ---------- Zustand ---------- */
let guest = null;
try { guest = JSON.parse(lsGet(LS_GUEST) || 'null'); } catch { guest = null; }
const S = {
  userId: lsGet(LS_USER),
  guest,               // {id, name} – Gast auf diesem Gerät
  users: {},           // id -> Daten
  usersLoaded: false,
  meals: {},           // id -> Daten der angezeigten Woche
  mealsLoaded: false,
  week: 0,             // 0 = diese Woche
  pending: null,       // {mealId, role: 'cook'|'eat'|'plus'}
  draft: '',
  addOpen: false,
  menuOpen: false,
  dlg: { mode: null, input: '', email: '', error: '', calOpen: false },
  error: null
};

/* ---------- Firebase ---------- */
const configMissing = !firebaseConfig || !firebaseConfig.apiKey || String(firebaseConfig.apiKey).includes('DEIN');
let db = null;
let unsubWeek = null;

if (configMissing) {
  $('#list').innerHTML = '<div class="setup-msg"><b>Noch nicht eingerichtet.</b><br>Bitte die Firebase-Konfiguration in <code>public/firebase-config.js</code> eintragen (siehe Anleitung im README).</div>';
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, (u) => {
    if (u) start();
  });
  signInAnonymously(auth).catch((e) => {
    console.error(e);
    $('#list').innerHTML = '<div class="setup-msg"><b>Verbindung fehlgeschlagen.</b><br>Ist die anonyme Anmeldung in Firebase aktiviert? Seite neu laden zum erneut Versuchen.</div>';
  });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  onSnapshot(collection(db, 'users'), (snap) => {
    const users = {};
    snap.forEach((d) => { users[d.id] = d.data(); });
    S.users = users;
    S.usersLoaded = true;
    if (S.userId && !users[S.userId]) { S.userId = null; lsSet(LS_USER, null); }
    render();
  }, (e) => showError(e));
  subscribeWeek();
}

function weekMonday() { return addDays(mondayOf(new Date()), 7 * S.week); }

function subscribeWeek() {
  if (unsubWeek) unsubWeek();
  S.meals = {};
  S.mealsLoaded = false;
  const wk = dkey(weekMonday());
  unsubWeek = onSnapshot(query(collection(db, 'meals'), where('week', '==', wk)), (snap) => {
    const meals = {};
    snap.forEach((d) => { meals[d.id] = d.data(); });
    S.meals = meals;
    S.mealsLoaded = true;
    render();
  }, (e) => showError(e));
  render(true);
}

function showError(e) {
  console.error(e);
  toast('Fehler bei der Verbindung zur Datenbank.');
}

/* ---------- Identität ---------- */
function me() {
  if (S.userId) {
    const u = S.users[S.userId];
    return { id: S.userId, kind: 'user', name: u ? u.name : '…' };
  }
  if (S.guest) return { id: S.guest.id, kind: 'guest', name: S.guest.name };
  return null;
}
const isMe = (e, w) => !!w && e.id === w.id;
function entryName(e) {
  if (e.kind === 'user' && S.users[e.id]) return S.users[e.id].name;
  return e.name;
}
function nameOf(id) { return S.users[id] ? S.users[id].name : null; }

/* ---------- Mahlzeit-Daten ---------- */
function defaultMeal(date, type) {
  return {
    date, type, week: dkey(mondayOf(parseKey(date))),
    time: DEFAULT_TIME[type], menu: '', cooks: [], eaters: [], participants: [],
    added: false, hidden: false, updatedAt: 0
  };
}
function normalize(m, date, type) {
  const d = defaultMeal(date, type);
  return {
    date: d.date, type: d.type, week: d.week,
    time: typeof m.time === 'string' && /^\d\d:\d\d$/.test(m.time) ? m.time : d.time,
    menu: typeof m.menu === 'string' ? m.menu : '',
    cooks: Array.isArray(m.cooks) ? m.cooks.map((e) => ({ ...e })) : [],
    eaters: Array.isArray(m.eaters) ? m.eaters.map((e) => ({ ...e })) : [],
    participants: [],
    added: !!m.added,
    hidden: !!m.hidden,
    updatedAt: 0
  };
}

async function mutate(mealId, fn) {
  const [date, type] = mealId.split('_');
  const ref = doc(db, 'meals', mealId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const m = normalize(snap.exists() ? snap.data() : {}, date, type);
      const ok = fn(m);
      if (ok === false) return;
      m.participants = [...new Set([...m.cooks, ...m.eaters].map((e) => e.id))];
      m.updatedAt = Date.now();
      tx.set(ref, m);
    });
  } catch (e) {
    console.error(e);
    toast('Speichern fehlgeschlagen. Bitte nochmals versuchen.');
  }
}

function isPast(mealId) {
  const [date, type] = mealId.split('_');
  const m = S.meals[mealId];
  const time = (m && m.time) || DEFAULT_TIME[type];
  return mealAt(date, time) < new Date();
}

function toggleRole(mealId, role, who) {
  if (isPast(mealId)) return;
  const entry = { id: who.id, name: who.name, kind: who.kind };
  mutate(mealId, (m) => {
    const inCooks = m.cooks.some((e) => e.id === who.id);
    const inEaters = m.eaters.some((e) => e.id === who.id && e.kind !== 'plus');
    if (role === 'cook') {
      if (inCooks) m.cooks = m.cooks.filter((e) => e.id !== who.id);
      else {
        m.cooks.push({ ...entry, since: Date.now() });
        if (!inEaters) m.eaters.push(entry);
      }
    } else {
      if (inEaters) m.eaters = m.eaters.filter((e) => !(e.id === who.id && e.kind !== 'plus'));
      else m.eaters.push(entry);
    }
  });
}

function addPlusGuest(mealId, name) {
  const w = me();
  if (!w || isPast(mealId)) return;
  mutate(mealId, (m) => {
    m.eaters.push({ id: 'p_' + randId(12), name, kind: 'plus', by: w.id, byName: w.name });
  });
}

function removeEntry(mealId, list, entryId) {
  if (isPast(mealId)) return;
  mutate(mealId, (m) => { m[list] = m[list].filter((e) => e.id !== entryId); });
}

/* ---------- Woche aufbauen ---------- */
function buildWeek() {
  const mon = weekMonday();
  const now = new Date();
  const thisMonday = mondayOf(now);
  const isArchive = mon < thisMonday;
  const w = me();
  const meals = [];
  const addables = [];

  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const key = dkey(d);
    const lunchId = key + '_L';
    const lunchDoc = S.meals[lunchId];
    const types = [];
    if (i >= 5 || (lunchDoc && lunchDoc.added)) types.push('L');
    types.push('D');
    if (i < 5 && !(lunchDoc && lunchDoc.added) && mealAt(key, DEFAULT_TIME.L) > now) {
      addables.push({ id: lunchId, label: `${DAYS[i]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} · Mittagessen` });
    }
    for (const t of types) {
      const id = `${key}_${t}`;
      const raw = S.meals[id];
      if (raw && raw.hidden) continue;
      const m = raw ? normalize(raw, key, t) : defaultMeal(key, t);
      const past = mealAt(key, m.time) < now;
      const cookActive = !!w && m.cooks.some((e) => e.id === w.id);
      const eatActive = !!w && m.eaters.some((e) => e.id === w.id && e.kind !== 'plus');
      const guestCook = m.cooks.some((e) => e.kind === 'guest');
      const canEdit = !past && (cookActive || guestCook);
      const empty = m.cooks.length === 0 && m.eaters.length === 0;
      meals.push({
        id, m, dayIdx: i, d, past, cookActive, eatActive, canEdit,
        status: m.cooks.length > 0 ? 'green' : (m.eaters.length > 0 ? 'red' : 'yellow'),
        canDelete: isArchive && past && empty
      });
    }
  }
  return { meals, addables, mon, isArchive };
}

/* ---------- Rendern ---------- */
let renderPending = false;
function inputFocused() {
  const a = document.activeElement;
  return !!a && a.tagName === 'INPUT' && a.type !== 'checkbox';
}
function render(force = false) {
  if (!force && inputFocused()) { renderPending = true; return; }
  renderPending = false;
  if (configMissing) return;
  renderHeader();
  renderList();
  renderDialog();
}
document.addEventListener('focusout', () => {
  setTimeout(() => { if (renderPending && !inputFocused()) render(); }, 300);
});

function renderHeader() {
  const w = me();
  const btn = $('#login-btn');
  $('#login-label').textContent = S.userId ? (w ? w.name : 'Konto') : 'Anmelden';
  btn.classList.toggle('is-in', !!S.userId);
  btn.setAttribute('aria-label', S.userId ? `Konto von ${w ? w.name : ''} öffnen` : 'Anmelden');
  const mon = weekMonday();
  const sun = addDays(mon, 6);
  const wk = S.week;
  const rel = wk === 0 ? 'Diese Woche' : wk === 1 ? 'Nächste Woche' : wk === -1 ? 'Letzte Woche' : (wk > 0 ? `In ${wk} Wochen` : `Vor ${-wk} Wochen`);
  $('#week-title').textContent = `${rel} · KW ${isoWeek(mon)}`;
  $('#week-range').textContent = `${mon.getDate()}. ${MONTHS[mon.getMonth()]} – ${sun.getDate()}. ${MONTHS[sun.getMonth()]} ${sun.getFullYear()}`;
  $('#today-btn').hidden = wk === 0;
}

function namesHtml(v, list) {
  const w = me();
  const entries = v.m[list];
  if (!entries.length) return '<div class="nobody">niemand</div>';
  return entries.map((e) => {
    const mine = isMe(e, w) && e.kind !== 'plus';
    let sub = '';
    if (e.kind === 'guest') sub = 'Gast';
    if (e.kind === 'plus') sub = `Gast von ${esc(nameOf(e.by) || e.byName || '?')}`;
    let removable = false;
    if (!v.past && !mine) {
      if (e.kind === 'guest') removable = true;
      if (e.kind === 'plus' && w && e.by === w.id) removable = true;
    }
    const canPlus = !v.past && mine && list === 'eaters';
    return `<div class="name-row">
      <div class="name-text">
        <div class="name-main${mine ? ' me' : ''}">${esc(entryName(e))}</div>
        ${sub ? `<div class="name-sub">${sub}</div>` : ''}
      </div>
      ${canPlus ? `<button type="button" class="mini-btn plus" data-action="plus" data-meal="${v.id}" aria-label="Gast hinzufügen">${svg(ICON.plus, 18, 2.6)}</button>` : ''}
      ${removable ? `<button type="button" class="mini-btn" data-action="remove" data-meal="${v.id}" data-list="${list}" data-entry="${esc(e.id)}" aria-label="${esc(entryName(e))} entfernen">${svg(ICON.x, 16, 2.6)}</button>` : ''}
    </div>`;
  }).join('');
}

function mealHtml(v) {
  const m = v.m;
  const dateLabel = `${DAYS[v.dayIdx]}, ${v.d.getDate()}. ${MONTHS[v.d.getMonth()]}`;
  const statusText = { green: 'Kochen ist geregelt', red: 'Niemand kocht!', yellow: 'Noch offen' }[v.status];
  const pend = S.pending && S.pending.mealId === v.id ? S.pending : null;
  const isPlus = pend && pend.role === 'plus';
  const inputId = `in-${v.id}`;
  const menuId = `menu-${v.id}`;
  const dis = v.past ? 'disabled' : '';

  return `<section class="meal ${v.status}" aria-label="${esc(dateLabel)}, ${TYPE_LABEL[m.type]}">
    <div class="cols">
      <div class="col">
        <button type="button" class="role-btn${v.cookActive ? ' active' : ''}" data-action="cook" data-meal="${v.id}" aria-pressed="${v.cookActive}" ${dis}>
          <span class="ico"><span class="base">${svg(ICON.chef, 26)}</span>${MINUS}</span>Kochen
        </button>
        <div class="names">${namesHtml(v, 'cooks')}</div>
      </div>
      <div class="col">
        <button type="button" class="role-btn${v.eatActive ? ' active' : ''}" data-action="eat" data-meal="${v.id}" aria-pressed="${v.eatActive}" ${dis}>
          <span class="ico"><span class="base">${svg(ICON.fork, 26)}</span>${MINUS}</span>Essen
        </button>
        <div class="names">${namesHtml(v, 'eaters')}</div>
      </div>
    </div>

    ${pend ? `<div class="inline-form">
      <label for="${inputId}">${isPlus ? 'Gast hinzufügen (hat keinen Zugang zur App)' : 'Du bist nicht angemeldet – wie heisst du?'}</label>
      <div class="inline-row">
        <input id="${inputId}" class="text-input" type="text" maxlength="40" autocomplete="off" data-role="draft" value="${esc(S.draft)}" placeholder="${isPlus ? 'Name des Gastes' : 'Dein Name'}">
        <button type="button" class="btn-dark" data-action="confirm">OK</button>
        <button type="button" class="btn-light btn-square" data-action="cancel" aria-label="Abbrechen">${svg(ICON.x, 16, 2.6)}</button>
      </div>
    </div>` : ''}

    ${v.canEdit ? `<div class="menu-field">
      <label for="${menuId}">Was gibt es?</label>
      <input id="${menuId}" class="text-input" type="text" maxlength="100" autocomplete="off" data-role="menu" data-meal="${v.id}" value="${esc(m.menu)}" placeholder="z.B. Gemüsecurry mit Reis">
    </div>` : (m.menu.trim() ? `<div class="menu-show">${svg(ICON.pot, 20)}<div><div class="lbl">Es gibt</div><div class="dish">${esc(m.menu)}</div></div></div>` : '')}

    <div class="meal-foot">
      <div>
        <div class="meal-date">${esc(dateLabel)} · ${TYPE_LABEL[m.type]}</div>
        <div class="meal-status">${statusText}</div>
      </div>
      ${v.canEdit
        ? `<input class="time-input" type="time" aria-label="Uhrzeit ändern" data-role="time" data-meal="${v.id}" value="${m.time}">`
        : `<div class="time-show">${svg(ICON.clock, 16, 2.2)}${m.time} Uhr</div>`}
    </div>
    ${v.past ? `<div class="past-note"><span>${svg(ICON.lock, 13, 2.2)}Vorbei – nur noch lesbar</span>${v.canDelete ? `<button type="button" class="del-btn" data-action="hide" data-meal="${v.id}">${svg(ICON.trash, 14, 2.2)}Leere Box löschen</button>` : ''}</div>` : ''}
  </section>`;
}

function renderList() {
  const list = $('#list');
  if (!S.mealsLoaded) { list.innerHTML = '<p class="loading">Lädt …</p>'; return; }
  const { meals, addables } = buildWeek();
  let html = meals.map(mealHtml).join('');
  html += `<div class="add-box">
    <button type="button" class="add-toggle" data-action="toggle-add" aria-expanded="${S.addOpen}">${svg(ICON.plus, 22, 2.4)}Mahlzeit hinzufügen</button>
    ${S.addOpen ? `<div class="add-list">
      ${addables.map((a) => `<button type="button" class="add-item" data-action="add-lunch" data-meal="${a.id}">${esc(a.label)}</button>`).join('')}
      ${addables.length ? '' : '<p class="add-empty">Diese Woche kann kein Mittagessen mehr ergänzt werden. Wische zur nächsten Woche.</p>'}
    </div>` : ''}
  </div>
  <p class="hint">Nach links wischen: nächste Woche · nach rechts: letzte Woche</p>`;
  list.innerHTML = html;
  if (S.pending) {
    const inp = document.getElementById(`in-${S.pending.mealId}`);
    if (inp && document.activeElement !== inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

/* ---------- Dialog (Konto) ---------- */
function renderDialog() {
  const root = $('#dialog-root');
  if (!S.menuOpen) { root.innerHTML = ''; return; }
  const D = S.dlg;
  const closeBtn = `<button type="button" class="round-btn" data-action="close-menu" aria-label="Schliessen">${svg(ICON.x, 18, 2.6)}</button>`;
  let body = '';
  let title = 'Anmelden';

  if (S.userId && S.users[S.userId]) {
    const u = S.users[S.userId];
    title = 'Mein Konto';
    const noEmail = !(u.email || '').trim();
    const host = location.host;
    const webcal = `webcal://${host}/kalender/${u.calToken}.ics`;
    const https = `https://${host}/kalender/${u.calToken}.ics`;
    body = `
      <div class="field">
        <label for="acc-name">Name</label>
        <input id="acc-name" class="text-input" type="text" maxlength="40" data-role="acc-name" value="${esc(u.name)}">
      </div>
      <div class="field">
        <label for="acc-mail">E-Mail (optional)</label>
        <input id="acc-mail" class="text-input" type="email" maxlength="100" data-role="acc-mail" value="${esc(u.email || '')}" placeholder="name@beispiel.ch">
      </div>
      ${D.error ? `<div class="error-text" role="alert">${esc(D.error)}</div>` : ''}
      <fieldset class="group">
        <legend>Erinnerungen per E-Mail</legend>
        <label class="check"><input type="checkbox" data-role="rem-cook" ${u.remCook && !noEmail ? 'checked' : ''} ${noEmail ? 'disabled' : ''}>
          <span><span class="t1">Wenn ich koche</span><span class="t2">2 Stunden vor der Mahlzeit</span></span></label>
        <label class="check"><input type="checkbox" data-role="rem-eat" ${u.remEat && !noEmail ? 'checked' : ''} ${noEmail ? 'disabled' : ''}>
          <span><span class="t1">Wenn ich esse</span><span class="t2">1 Stunde vor der Mahlzeit</span></span></label>
        <p class="small">${noEmail
          ? 'Ohne E-Mail-Adresse gibt es keine Erinnerungen und keine Warnungen.'
          : 'Warnungen (Koch springt ab, Esser ändern sich) kommen automatisch – 5 Minuten verzögert und gebündelt.'}</p>
      </fieldset>
      <button type="button" class="btn-wide light" data-action="toggle-cal" aria-expanded="${D.calOpen}">${svg(ICON.cal, 20)}Kalender abonnieren</button>
      ${D.calOpen ? `<div class="cal-box">
        <p class="small">Zeigt alle Mahlzeiten, bei denen du kochst oder isst, und aktualisiert sich automatisch.</p>
        <div class="cal-actions">
          <a class="btn-light" href="${esc(webcal)}">Im Kalender öffnen</a>
          <button type="button" class="btn-light" data-action="copy-cal" data-url="${esc(https)}">Link kopieren</button>
        </div>
        <div class="cal-url">${esc(https)}</div>
        <p class="small">iPhone/Mac: «Im Kalender öffnen». Google Kalender: Link kopieren, dann am Computer unter «Weitere Kalender → Per URL» einfügen. Google aktualisiert nur alle paar Stunden.</p>
      </div>` : ''}
      <button type="button" class="btn-wide soft" data-action="logout">Abmelden</button>`;
  } else if (D.mode === 'register') {
    title = 'Neu registrieren';
    const looksMail = D.input.includes('@');
    body = `
      <p>Es gibt noch kein Konto «${esc(D.input)}». Neu registrieren?</p>
      <div class="field">
        <label for="reg-name">Name</label>
        <input id="reg-name" class="text-input" type="text" maxlength="40" data-role="reg-name" value="${esc(looksMail ? '' : D.input)}">
      </div>
      <div class="field">
        <label for="reg-mail">E-Mail (optional)</label>
        <input id="reg-mail" class="text-input" type="email" maxlength="100" data-role="reg-mail" value="${esc(looksMail ? D.input : D.email)}" placeholder="name@beispiel.ch">
      </div>
      ${D.error ? `<div class="error-text" role="alert">${esc(D.error)}</div>` : ''}
      <button type="button" class="btn-wide dark" data-action="register">Registrieren</button>
      <button type="button" class="btn-wide soft" data-action="back-login">Zurück</button>`;
  } else {
    body = `
      <p>Name oder E-Mail eingeben – kein Passwort nötig. Dieses Gerät bleibt danach angemeldet.</p>
      <div class="field">
        <label for="login-input">Name oder E-Mail</label>
        <input id="login-input" class="text-input" type="text" maxlength="100" autocomplete="username" data-role="login" value="${esc(D.input)}">
      </div>
      ${D.error ? `<div class="error-text" role="alert">${esc(D.error)}</div>` : ''}
      <button type="button" class="btn-wide dark" data-action="login">Anmelden</button>
      <button type="button" class="btn-wide soft" data-action="close-menu">Als Gast weiter</button>
      ${S.guest ? `<p class="small">Dieses Gerät trägt dich als Gast «${esc(S.guest.name)}» ein. <button type="button" class="btn-light" data-action="forget-guest" style="margin-top:6px">Gastnamen vergessen</button></p>` : ''}`;
  }

  root.innerHTML = `<div class="overlay" data-action="overlay">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head"><h2 class="sheet-title" id="sheet-title">${title}</h2>${closeBtn}</div>
      ${body}
    </div>
  </div>`;
}

function openMenu() {
  S.menuOpen = true;
  S.dlg = { mode: null, input: '', email: '', error: '', calOpen: false };
  render(true);
  const first = document.querySelector('#dialog-root input');
  if (first && !S.userId) first.focus();
}
function closeMenu() { S.menuOpen = false; render(true); }

function findUser(v) {
  const low = v.trim().toLowerCase();
  return Object.entries(S.users).find(([, u]) => u.nameLower === low || (u.emailLower && u.emailLower === low));
}

function doLogin() {
  const v = (document.getElementById('login-input')?.value || S.dlg.input).trim();
  S.dlg.input = v;
  S.dlg.error = '';
  if (!v) { S.dlg.error = 'Bitte Name oder E-Mail eingeben.'; render(true); return; }
  if (!S.usersLoaded) { S.dlg.error = 'Noch nicht verbunden – bitte kurz warten.'; render(true); return; }
  const found = findUser(v);
  if (found) {
    S.userId = found[0];
    lsSet(LS_USER, S.userId);
    S.pending = null;
    closeMenu();
    toast(`Angemeldet als ${found[1].name}`);
  } else {
    S.dlg.mode = 'register';
    render(true);
    document.getElementById('reg-name')?.focus();
  }
}

async function doRegister() {
  const name = (document.getElementById('reg-name')?.value || '').trim();
  const email = (document.getElementById('reg-mail')?.value || '').trim();
  S.dlg.email = email;
  S.dlg.error = '';
  if (!name) S.dlg.error = 'Bitte einen Namen eingeben.';
  else if (findUser(name)) S.dlg.error = `Den Namen «${name}» gibt es schon. Bitte einen anderen wählen oder dich damit anmelden.`;
  else if (email && !validEmail(email)) S.dlg.error = 'Die E-Mail-Adresse sieht nicht gültig aus.';
  else if (email && findUser(email)) S.dlg.error = 'Diese E-Mail-Adresse gehört schon zu einem Konto.';
  if (S.dlg.error) { render(true); return; }
  try {
    const ref = await addDoc(collection(db, 'users'), {
      name, nameLower: name.toLowerCase(), email, emailLower: email.toLowerCase(),
      remCook: false, remEat: false, calToken: randId(28), createdAt: Date.now()
    });
    S.userId = ref.id;
    lsSet(LS_USER, ref.id);
    S.pending = null;
    S.users[ref.id] = S.users[ref.id] || { name, nameLower: name.toLowerCase(), email, emailLower: email.toLowerCase(), remCook: false, remEat: false };
    closeMenu();
    toast(`Willkommen, ${name}!`);
  } catch (e) {
    console.error(e);
    S.dlg.error = 'Registrieren fehlgeschlagen.';
    render(true);
  }
}

async function updateMe(fields) {
  if (!S.userId) return;
  try { await updateDoc(doc(db, 'users', S.userId), fields); toast('Gespeichert'); }
  catch (e) { console.error(e); toast('Speichern fehlgeschlagen.'); }
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const mealId = el.dataset.meal;

  if (a === 'overlay') { if (ev.target === el) closeMenu(); return; }

  switch (a) {
    case 'open-menu': openMenu(); break;
    case 'close-menu': closeMenu(); break;
    case 'prev-week': goWeek(-1); break;
    case 'next-week': goWeek(1); break;
    case 'this-week': goWeek(-S.week); break;
    case 'cook':
    case 'eat': {
      const w = me();
      const role = a;
      if (S.userId && !S.users[S.userId]) return; // Konto noch nicht geladen
      if (!w) { S.pending = { mealId, role }; S.draft = ''; render(true); return; }
      toggleRole(mealId, role, w);
      break;
    }
    case 'plus': S.pending = { mealId, role: 'plus' }; S.draft = ''; render(true); break;
    case 'confirm': confirmPending(); break;
    case 'cancel': S.pending = null; S.draft = ''; render(true); break;
    case 'remove': removeEntry(mealId, el.dataset.list, el.dataset.entry); break;
    case 'toggle-add': S.addOpen = !S.addOpen; render(true); break;
    case 'add-lunch':
      S.addOpen = false;
      mutate(mealId, (m) => { m.added = true; m.hidden = false; });
      render(true);
      break;
    case 'hide':
      if (confirm('Diese leere Box aus dem Archiv löschen?')) mutate(mealId, (m) => { if (m.cooks.length || m.eaters.length) return false; m.hidden = true; });
      break;
    case 'login': doLogin(); break;
    case 'register': doRegister(); break;
    case 'back-login': S.dlg.mode = null; S.dlg.error = ''; render(true); break;
    case 'logout':
      S.userId = null; lsSet(LS_USER, null); S.menuOpen = false; S.pending = null;
      render(true); toast('Abgemeldet');
      break;
    case 'forget-guest': S.guest = null; lsSet(LS_GUEST, null); render(true); break;
    case 'toggle-cal': S.dlg.calOpen = !S.dlg.calOpen; render(true); break;
    case 'copy-cal': {
      const url = el.dataset.url;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(() => toast('Link kopiert'))
        .catch(() => toast('Kopieren nicht möglich – Link bitte markieren.'));
      break;
    }
    default: break;
  }
});

function confirmPending() {
  const p = S.pending;
  const inp = p && document.getElementById(`in-${p.mealId}`);
  const name = ((inp && inp.value) || S.draft || '').trim();
  if (!p) return;
  if (!name) { inp && inp.focus(); return; }
  S.pending = null;
  S.draft = '';
  if (p.role === 'plus') addPlusGuest(p.mealId, name);
  else {
    S.guest = { id: 'g_' + randId(16), name };
    lsSet(LS_GUEST, JSON.stringify(S.guest));
    toggleRole(p.mealId, p.role, { id: S.guest.id, kind: 'guest', name });
  }
  if (document.activeElement) document.activeElement.blur();
  render(true);
}

document.addEventListener('input', (ev) => {
  const r = ev.target.dataset.role;
  if (r === 'draft') S.draft = ev.target.value;
  if (r === 'login') S.dlg.input = ev.target.value;
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    const r = ev.target.dataset && ev.target.dataset.role;
    if (r === 'draft') { ev.preventDefault(); confirmPending(); }
    else if (r === 'login') { ev.preventDefault(); doLogin(); }
    else if (r === 'reg-name' || r === 'reg-mail') { ev.preventDefault(); doRegister(); }
    else if (r === 'menu' || r === 'acc-name' || r === 'acc-mail') { ev.preventDefault(); ev.target.blur(); }
  } else if (ev.key === 'Escape' && S.menuOpen) {
    closeMenu();
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  const r = t.dataset.role;
  const mealId = t.dataset.meal;
  if (r === 'time') {
    const v = t.value;
    if (!/^\d\d:\d\d$/.test(v)) return;
    mutate(mealId, (m) => { m.time = v; });
  } else if (r === 'menu') {
    const v = t.value.trim().slice(0, 100);
    mutate(mealId, (m) => { if (m.menu === v) return false; m.menu = v; });
  } else if (r === 'acc-name') {
    const v = t.value.trim();
    const u = S.users[S.userId];
    if (!u || v === u.name) return;
    const other = findUser(v);
    if (!v) { S.dlg.error = 'Der Name darf nicht leer sein.'; render(true); return; }
    if (other && other[0] !== S.userId) { S.dlg.error = `Den Namen «${v}» gibt es schon.`; render(true); return; }
    S.dlg.error = '';
    updateMe({ name: v, nameLower: v.toLowerCase() });
  } else if (r === 'acc-mail') {
    const v = t.value.trim();
    const u = S.users[S.userId];
    if (!u || v === (u.email || '')) return;
    if (v && !validEmail(v)) { S.dlg.error = 'Die E-Mail-Adresse sieht nicht gültig aus.'; render(true); return; }
    const other = v && findUser(v);
    if (other && other[0] !== S.userId) { S.dlg.error = 'Diese E-Mail-Adresse gehört schon zu einem Konto.'; render(true); return; }
    S.dlg.error = '';
    updateMe({ email: v, emailLower: v.toLowerCase() });
  } else if (r === 'rem-cook') {
    updateMe({ remCook: t.checked });
  } else if (r === 'rem-eat') {
    updateMe({ remEat: t.checked });
  }
});

/* ---------- Woche wechseln + Wischen ---------- */
function goWeek(n) {
  if (!n) return;
  S.week += n;
  S.pending = null;
  S.addOpen = false;
  const list = $('#list');
  list.classList.remove('slide-next', 'slide-prev');
  void list.offsetWidth;
  list.classList.add(n > 0 ? 'slide-next' : 'slide-prev');
  subscribeWeek();
  window.scrollTo({ top: 0 });
}

let sx = null, sy = null;
const listEl = $('#list');
listEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('input')) { sx = null; return; }
  sx = e.clientX; sy = e.clientY;
});
listEl.addEventListener('pointerup', (e) => {
  if (sx == null) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  sx = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) goWeek(dx < 0 ? 1 : -1);
});
listEl.addEventListener('pointercancel', () => { sx = null; });

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// Vergangene Mahlzeiten werden ohne Neuladen gesperrt
setInterval(() => render(), 60 * 1000);
