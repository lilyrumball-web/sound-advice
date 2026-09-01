/* Sound Advice — data layer
   ---------------------------------------------------------------
   Local first, cloud second.

   Everything is written to the phone the instant it happens, so a
   study session is never lost to bad wifi. A copy is then queued for
   the shared database and sent when there is a connection. If Firebase
   has not been set up yet the app still works perfectly -- it just
   keeps everything on the device.

   No names, no emails, no birthdays. A nickname and a PIN, and the PIN
   is stored only as a hash.
   --------------------------------------------------------------- */

const K = {
  user:     'sa.user',
  sessions: 'sa.sessions',
  tests:    'sa.tests',
  feedback: 'sa.feedback',
  queue:    'sa.queue',
  settings: 'sa.settings'
};

export let mode = 'local';      // 'local' | 'cloud'
let fb = null;                  // firebase handles once loaded

/* ---------- little helpers ---------- */

const read = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { return false; }
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function hashPin(nickname, pin) {
  const data = new TextEncoder().encode(`sound-advice:${nickname.toLowerCase()}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function deviceInfo() {
  const ua = navigator.userAgent;
  const kind = /iPhone|iPod/.test(ua) ? 'iPhone'
             : /iPad/.test(ua) ? 'iPad'
             : /Android/.test(ua) ? 'Android'
             : /Macintosh/.test(ua) ? 'Mac'
             : /Windows/.test(ua) ? 'Windows' : 'Other';
  return {
    kind,
    screen: `${window.screen.width}x${window.screen.height}`,
    standalone: window.matchMedia('(display-mode: standalone)').matches ||
                navigator.standalone === true
  };
}

/* ---------- Firebase (optional) ---------- */

export async function initBackend() {
  const cfg = window.SA_FIREBASE_CONFIG;
  if (!cfg || !cfg.projectId || String(cfg.apiKey || '').startsWith('PASTE')) {
    mode = 'local';
    return mode;
  }
  try {
    const V = 'https://www.gstatic.com/firebasejs/10.12.2';
    const [{ initializeApp }, fs, auth] = await Promise.all([
      import(`${V}/firebase-app.js`),
      import(`${V}/firebase-firestore.js`),
      import(`${V}/firebase-auth.js`)
    ]);
    const app = initializeApp(cfg);
    const db = fs.getFirestore(app);
    await auth.signInAnonymously(auth.getAuth(app));
    fb = { db, fs };
    mode = 'cloud';
  } catch (err) {
    console.warn('Cloud unavailable, staying local:', err);
    mode = 'local';
  }
  return mode;
}

/* ---------- accounts ---------- */

export function currentUser() { return read(K.user, null); }

export async function signIn(nickname, pin) {
  const name = nickname.trim();
  if (name.length < 2) throw new Error('Pick a nickname with at least 2 letters.');
  if (!/^\d{4}$/.test(pin)) throw new Error('Your PIN needs to be exactly 4 digits.');

  const pinHash = await hashPin(name, pin);
  const key = name.toLowerCase();

  if (mode === 'cloud') {
    try {
      const { db, fs } = fb;
      const ref = fs.doc(db, 'users', key);
      const snap = await fs.getDoc(ref);

      if (snap.exists()) {
        const u = snap.data();
        if (u.pinHash !== pinHash) throw new Error('That nickname is taken, or the PIN is wrong.');
        const user = { ...u, id: key };
        write(K.user, user);
        await pullMine(key);
        await fs.setDoc(ref, { lastActive: Date.now(), device: deviceInfo() }, { merge: true });
        return { user, returning: true };
      }

      const user = {
        id: key, nickname: name, pinHash,
        joined: Date.now(), lastActive: Date.now(),
        device: deviceInfo(), recommended: null
      };
      await fs.setDoc(ref, user);
      write(K.user, user);
      return { user, returning: false };
    } catch (e) {
      // A wrong nickname/PIN combo is a real rejection and should stop
      // here. Anything else (permission-denied, offline, a misconfigured
      // Firestore rule that hasn't propagated yet) means the cloud isn't
      // cooperating right now -- fall through to local-only rather than
      // locking the person out entirely. Their data stays on this device
      // and can sync later once the cloud side is sorted out.
      if (e.message && e.message.includes('nickname is taken')) throw e;
      console.warn('Cloud sign-in failed, continuing locally:', e);
      mode = 'local';
    }
  }

  // Local-only mode: one account per device. Also the fallback above.
  const existing = currentUser();
  if (existing && existing.id === key) {
    if (existing.pinHash !== pinHash) throw new Error('Wrong PIN for that nickname.');
    existing.lastActive = Date.now();
    write(K.user, existing);
    return { user: existing, returning: true, cloudFailed: true };
  }
  const user = {
    id: key, nickname: name, pinHash,
    joined: Date.now(), lastActive: Date.now(),
    device: deviceInfo(), recommended: null
  };
  write(K.user, user);
  return { user, returning: false, cloudFailed: true };
}

export function signOut() {
  localStorage.removeItem(K.user);
}

export async function updateUser(patch) {
  const u = currentUser();
  if (!u) return null;
  const next = { ...u, ...patch };
  write(K.user, next);
  if (mode === 'cloud') {
    try { await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', u.id), patch, { merge: true }); }
    catch (e) { console.warn('User update queued for later', e); }
  }
  return next;
}

export async function deleteEverything() {
  const u = currentUser();
  if (u && mode === 'cloud') {
    try {
      const { db, fs } = fb;
      await fs.setDoc(fs.doc(db, 'users', u.id), { deleted: true, deletedAt: Date.now() }, { merge: true });
      for (const c of ['sessions', 'tests']) {
        const q = fs.query(fs.collection(db, c), fs.where('userId', '==', u.id));
        const snap = await fs.getDocs(q);
        await Promise.all(snap.docs.map(d => fs.deleteDoc(d.ref)));
      }
    } catch (e) { console.warn('Cloud delete failed', e); }
  }
  Object.values(K).forEach(k => localStorage.removeItem(k));
}

/* ---------- records ---------- */

function localAdd(kind, record) {
  const list = read(K[kind], []);
  list.push(record);
  write(K[kind], list);
}

function queueUp(collection, record) {
  const q = read(K.queue, []);
  q.push({ collection, record });
  write(K.queue, q);
}

export async function flushQueue() {
  if (mode !== 'cloud') return { sent: 0, pending: read(K.queue, []).length };
  const q = read(K.queue, []);
  if (!q.length) return { sent: 0, pending: 0 };

  const { db, fs } = fb;
  const left = [];
  let sent = 0;
  for (const item of q) {
    try {
      await fs.setDoc(fs.doc(db, item.collection, item.record.id), item.record);
      sent++;
    } catch (e) { left.push(item); }
  }
  write(K.queue, left);
  return { sent, pending: left.length };
}

export function pendingCount() { return read(K.queue, []).length; }

export async function saveSession(session) {
  const u = currentUser();
  const rec = { id: uid(), userId: u ? u.id : 'anon', nickname: u ? u.nickname : '', ...session };
  localAdd('sessions', rec);
  queueUp('sessions', rec);
  flushQueue().catch(() => {});
  return rec;
}

export async function saveTest(test) {
  const u = currentUser();
  const rec = { id: uid(), userId: u ? u.id : 'anon', nickname: u ? u.nickname : '', ...test };
  localAdd('tests', rec);
  queueUp('tests', rec);
  flushQueue().catch(() => {});
  return rec;
}

export const getSessions = () => read(K.sessions, []);
export const getTests = () => read(K.tests, []);

export async function saveFeedback(item) {
  const u = currentUser();
  const rec = {
    id: uid(), userId: u ? u.id : 'anon', nickname: u ? u.nickname : '',
    device: deviceInfo().kind, ...item
  };
  localAdd('feedback', rec);
  queueUp('feedback', rec);
  flushQueue().catch(() => {});
  return rec;
}

export const getFeedback = () => read(K.feedback, []);

/** Pull this person's own records down when they sign in somewhere new. */
async function pullMine(userId) {
  if (mode !== 'cloud') return;
  try {
    const { db, fs } = fb;
    for (const c of ['sessions', 'tests']) {
      const snap = await fs.getDocs(fs.query(fs.collection(db, c), fs.where('userId', '==', userId)));
      const remote = snap.docs.map(d => d.data());
      const local = read(K[c], []);
      const seen = new Set(local.map(r => r.id));
      write(K[c], [...local, ...remote.filter(r => !seen.has(r.id))]);
    }
  } catch (e) { console.warn('Could not pull history', e); }
}

/* ---------- settings ---------- */

export const getSettings = () => read(K.settings, {
  sound: 'brown', volume: 0.6, tone: 0.55,
  mode: 'pomodoro', workMin: 25, breakMin: 5,
  seenPrivacy: false, seenOnboard: false, testCount: 0
});

export const saveSettings = s => write(K.settings, s);

/* ---------- admin ---------- */

export async function fetchAll() {
  if (mode !== 'cloud') {
    return {
      users: [currentUser()].filter(Boolean),
      sessions: getSessions(), tests: getTests(), feedback: getFeedback(),
      local: true
    };
  }
  const { db, fs } = fb;
  const grab = async c => (await fs.getDocs(fs.collection(db, c))).docs.map(d => d.data());
  const [users, sessions, tests, feedback] = await Promise.all(
    [grab('users'), grab('sessions'), grab('tests'), grab('feedback')]);
  return { users, sessions, tests, feedback, local: false };
}

export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(Object.keys))];
  const cell = v => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}
