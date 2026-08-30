/* Sound Advice — application
   Screens, timer, test flow, patterns. */

import * as audio from './audio.js?v=23';
import * as store from './store.js?v=23';
import { runBlock, buildScenes, TEST_SECONDS } from './gonogo.js?v=23';

const $  = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

const TRIALS_PER_BLOCK = 187;          // 187 x 0.8 s = 2 min 30
const BREAK_SECONDS = 45;

// The concentration test only ever runs on these four conditions --
// matching the 2025 pilot (silence, white noise, classical, lyrical).
// Study sessions can use any sound in the library (rain, forest, brown
// noise, etc), but the TEST must stay confined to these four or a
// person's tested-best result stops being comparable to anyone else's.
const TEST_SOUNDS = ['silence', 'white', 'classical', 'lyrical'];

let settings = store.getSettings();
let user = null;
let session = null;                    // the study session in progress
let testRun = null;                    // the test in progress
let rating = { score: null, tags: [] };
let tipiAnswers = [];                  // in-progress personality-check answers
let tipiReturnTo = 'onboard';          // screen to go back to after the check

// The TIPI (Ten Item Personality Inventory) -- Gosling, Rentfrow & Swann
// (2003), freely usable for any purpose. Order matters and must not be
// shuffled: reverse-scoring depends on knowing which position is which.
const TIPI_ITEMS = [
  { n: 1,  text: 'Extraverted, enthusiastic',          dim: 'Extraversion',        rev: false },
  { n: 2,  text: 'Critical, quarrelsome',               dim: 'Agreeableness',       rev: true  },
  { n: 3,  text: 'Dependable, self-disciplined',        dim: 'Conscientiousness',   rev: false },
  { n: 4,  text: 'Anxious, easily upset',               dim: 'Emotional stability', rev: true  },
  { n: 5,  text: 'Open to new experiences, complex',    dim: 'Openness',            rev: false },
  { n: 6,  text: 'Reserved, quiet',                     dim: 'Extraversion',        rev: true  },
  { n: 7,  text: 'Sympathetic, warm',                   dim: 'Agreeableness',       rev: false },
  { n: 8,  text: 'Disorganized, careless',              dim: 'Conscientiousness',   rev: true  },
  { n: 9,  text: 'Calm, emotionally stable',            dim: 'Emotional stability', rev: false },
  { n: 10, text: 'Conventional, uncreative',            dim: 'Openness',            rev: true  }
];

// Reverse-score (7<->1, 6<->2, 5<->3, 4 stays), then average the two items
// per dimension. Scoring all five costs nothing extra, even though only
// Extraversion is needed for the headline hypothesis.
function scoreTipi(raw) {
  const rev = v => 8 - v;
  const val = i => TIPI_ITEMS[i].rev ? rev(raw[i]) : raw[i];
  const byDim = {};
  TIPI_ITEMS.forEach((item, i) => (byDim[item.dim] = byDim[item.dim] || []).push(val(i)));
  const scores = {};
  for (const [dim, vals] of Object.entries(byDim)) {
    scores[dim] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
  }
  return scores;
}

/* ================================================================
   Navigation
   ================================================================ */

let screen = 'signin';

function go(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `s-${name}`));
  screen = name;
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'sounds') renderSounds();
  if (name === 'patterns') renderPatterns();
  if (name === 'settings') renderSettings();
  if (name === 'tipi') renderTipi();
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const fmtClock = s => {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const fmtMins = m => m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;

/* ================================================================
   Start-up
   ================================================================ */

async function boot() {
  await store.initBackend();
  user = store.currentUser();

  wireEverything();
  updateSyncDot();

  if (!user) { go('signin'); return; }
  if (!settings.seenPrivacy) { go('privacy'); return; }
  if (!settings.seenOnboard) { go('onboard'); return; }
  go('home');

  store.flushQueue().then(updateSyncDot).catch(() => {});
  // Fetch and decode the test photographs while the phone is idle, so the
  // test starts instantly later. Failing here is fine -- runBlock retries.
  buildScenes().catch(() => {});
  audio.prepare(settings.sound, settings.tone).catch(() => {});
}

function updateSyncDot() {
  const dot = $('syncDot');
  if (!dot) return;
  const pending = store.pendingCount();
  dot.className = 'sync-dot ' + (store.mode !== 'cloud' ? '' : pending ? 'pending' : 'ok');
  dot.title = store.mode !== 'cloud'
    ? 'Saved on this device only'
    : pending ? `${pending} waiting to sync` : 'Everything synced';
}

/* ================================================================
   Sign in
   ================================================================ */

async function doSignIn() {
  const btn = $('signinBtn');
  const err = $('signinErr');
  err.textContent = '';
  btn.disabled = true;
  try {
    const res = await store.signIn($('nickname').value, $('pin').value);
    user = res.user;
    settings = store.getSettings();
    go(settings.seenPrivacy ? (settings.seenOnboard ? 'home' : 'onboard') : 'privacy');
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ================================================================
   Home
   ================================================================ */

function bestTestedSound() {
  const byId = {};
  for (const t of store.getTests()) {
    (byId[t.soundId] = byId[t.soundId] || []).push(t.dprime);
  }
  const avg = Object.entries(byId)
    .map(([id, ds]) => ({ id, d: ds.reduce((a, b) => a + b, 0) / ds.length, n: ds.length }))
    .sort((a, b) => b.d - a.d);
  return avg.length >= 2 ? avg[0] : null;      // one sound tested tells you nothing
}

function weekStats() {
  const sessions = store.getSessions().filter(s => s.outcome !== 'abandoned');
  const weekAgo = Date.now() - 7 * 864e5;
  const thisWeek = sessions.filter(s => s.startedAt > weekAgo);
  const totalMin = sessions.reduce((sum, s) => sum + (s.actualMinutes || 0), 0);

  const days = new Set(sessions.map(s => new Date(s.startedAt).toDateString()));
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.now() - i * 864e5).toDateString();
    if (days.has(d)) streak++;
    else if (i > 0) break;
  }
  return { week: thisWeek.length, totalMin, streak };
}

function renderHome() {
  const s = audio.soundById(settings.sound);
  $('homeSoundName').textContent = s.name;
  $('homeSoundDesc').textContent = s.desc;

  const best = bestTestedSound();
  $('homeBestBadge').hidden = !(best && best.id === settings.sound);

  $$('#modeSeg button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode)));
  $('pomoControls').hidden = settings.mode !== 'pomodoro';
  $('workMin').value = settings.workMin;
  $('breakMin').value = settings.breakMin;

  $('startSub').textContent = settings.mode === 'pomodoro'
    ? `${settings.workMin} minutes · ${s.name}`
    : `Open-ended · ${s.name}`;

  const st = weekStats();
  $('statSessions').textContent = st.week;
  $('statHours').textContent = fmtMins(st.totalMin);
  $('statStreak').textContent = st.streak;

  const tested = new Set(store.getTests().map(t => t.soundId));
  $('homeHint').textContent =
    tested.size === 0 ? 'You haven’t tested any sounds yet — "Test a sound" takes 2½ minutes.'
    : tested.size === 1 ? 'Test one more sound and I can start comparing them for you.'
    : best && best.id !== settings.sound
      ? `You focus best with ${audio.soundById(best.id).name}, based on your tests.`
      : '';

  $('toTipiHome').textContent = (user && user.tipi)
    ? 'Retake the personality check'
    : 'Personality check (1 min, optional)';
}

/* ================================================================
   Sound picker
   ================================================================ */

let previewing = null;

async function renderSounds() {
  $('volume').value = Math.round(settings.volume * 100);
  $('tone').value = Math.round(settings.tone * 100);
  $('toneField').hidden = !audio.soundById(settings.sound).tone;

  const tests = store.getTests();
  const scoreFor = id => {
    const mine = tests.filter(t => t.soundId === id);
    if (!mine.length) return null;
    return Math.round(mine.reduce((a, t) => a + t.focusScore, 0) / mine.length);
  };
  const best = bestTestedSound();

  const list = $('soundList');
  list.innerHTML = '';

  for (const fam of audio.FAMILIES) {
    const inFam = audio.SOUNDS.filter(s => s.family === fam);
    if (!inFam.length) continue;

    const wrap = document.createElement('div');
    wrap.className = 'family';
    wrap.style.setProperty('--fam', audio.FAMILY_COLORS[fam] || '');
    wrap.innerHTML = `<span class="label">${fam}</span>`;

    for (const s of inFam) {
      const available = s.file ? await audio.fileAvailable(s) : true;
      const sc = scoreFor(s.id);
      const btn = document.createElement('button');
      btn.className = 'sound';
      btn.setAttribute('aria-pressed', String(settings.sound === s.id));
      if (!available) btn.disabled = true;
      btn.innerHTML = `
        <div>
          <div class="sound-name">${s.name}
            ${best && best.id === s.id ? '<span class="badge">Your best</span>' : ''}
            ${!available ? '<span class="badge badge-plain">Not added yet</span>' : ''}
          </div>
          <div class="sound-meta">${s.desc}${sc !== null ? ` · you scored ${sc}` : ''}</div>
        </div>
        <span class="preview-btn" data-preview="${s.id}">${s.id === 'silence' ? '—' : '▶'}</span>`;

      btn.addEventListener('click', async ev => {
        if (ev.target.dataset.preview) { await preview(s.id); return; }
        settings.sound = s.id;
        store.saveSettings(settings);
        stopPreview();
        renderSounds();
        $('toneField').hidden = !s.tone;
      });
      wrap.appendChild(btn);
    }
    list.appendChild(wrap);
  }
}

async function preview(id) {
  if (previewing === id) { stopPreview(); return; }
  stopPreview();
  if (id === 'silence') return;
  previewing = id;
  const name = audio.soundById(id).name;
  toast(`Generating ${name}…`, 8000);
  try {
    await audio.play(id, { tone: settings.tone, volume: settings.volume });
    toast(`Playing ${name} — tap again to stop`, 2600);
  } catch { toast('Tap again to allow sound'); previewing = null; }
}

function stopPreview() {
  if (previewing) { audio.stop(); previewing = null; }
}

/* ================================================================
   Study session
   ================================================================ */

let ticker = null;
let wakeLock = null;

async function startSession() {
  const s = audio.soundById(settings.sound);
  document.body.style.setProperty('--fam', audio.FAMILY_COLORS[s.family] || '');
  const btn = $('startBtn');
  const sub = $('startSub');

  // The first time a sound is used it has to be generated, which takes
  // a moment. Say so, rather than looking broken.
  btn.disabled = true;
  const wasSub = sub.textContent;
  sub.textContent = 'Preparing the sound…';

  try {
    await audio.play(settings.sound, { tone: settings.tone, volume: settings.volume });
  } catch {
    toast('Tap "Start studying" once more to let the sound play');
    return;
  } finally {
    btn.disabled = false;
    sub.textContent = wasSub;
  }

  session = {
    startedAt: Date.now(),
    pausedMs: 0,
    pausedAt: null,
    mode: settings.mode,
    plannedMinutes: settings.mode === 'pomodoro' ? settings.workMin : null,
    soundId: settings.sound,
    soundName: s.name,
    volume: settings.volume,
    tone: s.tone ? settings.tone : null,
    leftAppCount: 0
  };

  document.addEventListener('visibilitychange', countLeaving);
  requestWakeLock();
  $('sessionSound').textContent = s.name;
  $('phaseLabel').textContent = 'Studying';
  $('pauseBtn').textContent = 'Pause';
  go('session');
  tick();
  ticker = setInterval(tick, 250);
}

function countLeaving() { if (document.hidden && session) session.leftAppCount++; }

async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
  catch {}
}
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

function elapsedSeconds() {
  if (!session) return 0;
  const paused = session.pausedMs + (session.pausedAt ? Date.now() - session.pausedAt : 0);
  // Elapsed time always comes from the real clock, never from counting
  // ticks -- phone browsers freeze timers the moment the screen locks.
  return (Date.now() - session.startedAt - paused) / 1000;
}

function tick() {
  if (!session) return;
  const el = elapsedSeconds();
  const ring = $('ringProg');
  const C = 339.29;

  if (session.mode === 'pomodoro') {
    const total = session.plannedMinutes * 60;
    const left = total - el;
    $('timerNum').textContent = fmtClock(left);
    ring.style.strokeDashoffset = C * (1 - Math.min(1, el / total));
    if (left <= 0) return endSession('completed');
  } else {
    $('timerNum').textContent = fmtClock(el);
    ring.style.strokeDashoffset = C * (1 - (el % 3600) / 3600);
  }
}

function togglePause() {
  if (!session) return;
  if (session.pausedAt) {
    session.pausedMs += Date.now() - session.pausedAt;
    session.pausedAt = null;
    $('pauseBtn').textContent = 'Pause';
    $('phaseLabel').textContent = 'Studying';
    audio.play(session.soundId, { tone: settings.tone, volume: settings.volume }).catch(() => {});
  } else {
    session.pausedAt = Date.now();
    $('pauseBtn').textContent = 'Resume';
    $('phaseLabel').textContent = 'Paused';
    audio.stop();
  }
}

async function endSession(outcome) {
  if (!session) return;
  clearInterval(ticker);
  ticker = null;
  document.removeEventListener('visibilitychange', countLeaving);
  releaseWakeLock();
  audio.stop();

  const minutes = elapsedSeconds() / 60;
  session.endedAt = Date.now();
  session.actualMinutes = +minutes.toFixed(2);
  session.outcome = outcome;

  if (outcome === 'completed') { chime(); vibrate([120, 80, 120]); }

  if (outcome === 'abandoned' || minutes < 0.5) {
    await store.saveSession({ ...session, rating: null, tags: [] });
    updateSyncDot();
    session = null;
    go('home');
    toast(outcome === 'abandoned' ? 'No worries — logged it anyway' : 'Too short to log a rating');
    return;
  }

  rating = { score: null, tags: [] };
  $$('#rateRow .rate-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
  $$('#tagRow .tag-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
  $('rateSave').disabled = true;
  $('rateSummary').textContent =
    `${Math.round(minutes)} min · ${session.soundName}` +
    (outcome === 'completed' ? ' · finished' : ' · stopped early');
  go('rate');
}

async function saveRating(skip) {
  await store.saveSession({
    ...session,
    rating: skip ? null : rating.score,
    tags: skip ? [] : rating.tags
  });
  updateSyncDot();
  session = null;
  go('home');
  toast(skip ? 'Session saved' : 'Nice one — saved');
}

function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [880, 1174.7].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + 1);
    });
    setTimeout(() => ctx.close(), 1600);
  } catch {}
}

const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ================================================================
   Concentration test
   ================================================================ */

async function fullTestSounds() {
  // No silent fallback: swapping in rain or brown noise when a music file
  // fails to load would quietly put some people through a different test
  // than everyone else. The four test sounds are fixed -- if one can't
  // load, the test refuses to run rather than substituting another sound.
  const missing = [];
  for (const id of ['classical', 'lyrical']) {
    if (!(await audio.fileAvailable(audio.soundById(id)))) missing.push(id);
  }
  if (missing.length) {
    const err = new Error('missing-test-audio');
    err.missing = missing;
    throw err;
  }
  return TEST_SOUNDS;
}

// Rotate the order so different people meet the sounds in a different
// sequence -- otherwise whichever sound came first would carry all the
// "still fresh" advantage.
function rotate(list, by) {
  const n = list.length;
  return list.map((_, i) => list[(i + by) % n]);
}

async function beginTest(kind, soundId) {
  let sounds;
  if (kind === 'full') {
    try {
      sounds = rotate(await fullTestSounds(), (settings.testCount || 0) % 4);
    } catch (err) {
      toast('Classical or lyrical audio could not load — check your connection and try again.');
      return;
    }
  } else {
    // Single test is always one of the four test sounds, never whatever
    // is currently selected for studying (which might be rain, forest,
    // brown noise, etc -- those aren't part of the concentration test).
    sounds = [TEST_SOUNDS.includes(soundId) ? soundId : 'silence'];
  }

  testRun = { kind, sounds, index: 0, results: [] };

  $('testIntroTitle').textContent = kind === 'full' ? 'The full test' : 'Test a sound';

  const choiceEl = $('testSoundChoice');
  if (kind === 'single') {
    choiceEl.hidden = false;
    choiceEl.innerHTML = TEST_SOUNDS.map(id => `
      <button class="tag-btn" data-sound="${id}"
              aria-pressed="${String(id === testRun.sounds[0])}">
        ${audio.soundById(id).name}
      </button>`).join('');
    choiceEl.querySelectorAll('[data-sound]').forEach(btn => {
      btn.addEventListener('click', () => {
        testRun.sounds = [btn.dataset.sound];
        choiceEl.querySelectorAll('[data-sound]').forEach(b =>
          b.setAttribute('aria-pressed', String(b === btn)));
        renderTestPlan();
      });
    });
  } else {
    choiceEl.hidden = true;
    choiceEl.innerHTML = '';
  }

  renderTestPlan();
  go('testintro');
}

function renderTestPlan() {
  $('testPlan').innerHTML = testRun.kind === 'full'
    ? `<strong>Four sounds, 2½ minutes each.</strong> There's a short break between them.
       About 12 minutes in total — make sure you won't be interrupted.`
    : `<strong>${audio.soundById(testRun.sounds[0]).name}, 2½ minutes.</strong>
       Your score gets added to the sounds you've already tried.`;
}

async function runNextBlock() {
  const soundId = testRun.sounds[testRun.index];
  const s = audio.soundById(soundId);

  $('hudSound').textContent = s.name;
  $('testStage').classList.add('active');

  if (soundId !== 'silence') {
    try { await audio.play(soundId, { tone: settings.tone, volume: settings.volume }); }
    catch { toast('Sound could not start'); }
  } else {
    audio.stop();
  }

  await new Promise(r => setTimeout(r, 2500));   // settle into the sound first

  let res;
  try {
    res = await runBlock({
      canvas: $('testCanvas'),
      totalTrials: TRIALS_PER_BLOCK,
      seed: Date.now() % 100000 + testRun.index,
      onProgress: (p, secsLeft) => {
        $('testBar').style.width = `${p * 100}%`;
        $('hudTime').textContent = fmtClock(secsLeft);
      }
    });
  } catch (err) {
    // Almost always the scene photographs failing to load on a first run
    // with no signal. Abandon the block rather than score a broken one.
    console.error(err);
    audio.stop();
    $('testStage').classList.remove('active');
    testRun = null;
    toast('The test images could not load. Try again once you have a connection.');
    go('home');
    return;
  }

  audio.stop();
  $('testStage').classList.remove('active');

  await store.saveTest({
    soundId,
    soundName: s.name,
    takenAt: Date.now(),
    kind: testRun.kind,
    volume: settings.volume,
    tone: s.tone ? settings.tone : null,
    device: store.deviceInfo().kind,
    ...res.stats,
    ...res.quality
  });
  updateSyncDot();

  testRun.results.push({ soundId, name: s.name, ...res.stats, ...res.quality });
  testRun.index++;

  settings.testCount = (settings.testCount || 0) + (testRun.index === testRun.sounds.length ? 1 : 0);
  store.saveSettings(settings);

  if (testRun.index < testRun.sounds.length) showBreak();
  else showTestResult();
}

function showBreak() {
  const next = audio.soundById(testRun.sounds[testRun.index]);
  $('nextSoundName').textContent = next.name;
  $('nextSoundDesc').textContent = next.desc;
  $('betweenText').textContent =
    `${testRun.index} of ${testRun.sounds.length} done. Rest your eyes for a moment.`;

  let left = BREAK_SECONDS;
  $('breakCount').textContent = left;
  go('between');

  clearInterval(ticker);
  ticker = setInterval(() => {
    left--;
    $('breakCount').textContent = Math.max(0, left);
    if (left <= 0) { clearInterval(ticker); ticker = null; runNextBlock(); }
  }, 1000);
}

function showTestResult() {
  const ranked = [...testRun.results].sort((a, b) => b.dprime - a.dprime);
  const top = ranked[0];
  const all = bestTestedSound();

  if (testRun.kind === 'full') {
    $('resultHeadline').textContent = `${top.name} suits you best`;
    $('resultSub').textContent =
      ranked.length > 1
        ? `Ahead of ${ranked[1].name} by ${(top.dprime - ranked[1].dprime).toFixed(2)} on the accuracy measure.`
        : '';
  } else {
    $('resultHeadline').textContent = `${top.name}: ${top.focusScore}`;
    $('resultSub').textContent = all && all.id !== top.soundId
      ? `Your best so far is still ${audio.soundById(all.id).name}.`
      : 'That’s your best score so far.';
  }

  const scores = testRun.kind === 'full'
    ? ranked.map(r => ({ name: r.name, v: r.focusScore }))
    : (() => {
        const byId = {};
        for (const t of store.getTests()) (byId[t.soundId] = byId[t.soundId] || []).push(t.focusScore);
        return Object.entries(byId)
          .map(([id, xs]) => ({ name: audio.soundById(id).name, v: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) }))
          .sort((a, b) => b.v - a.v);
      })();

  const max = Math.max(1, ...scores.map(s => s.v));
  $('resultBars').innerHTML = scores.map(s => `
    <div class="bar-row">
      <span>${s.name}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(s.v / max) * 100}%"></span></span>
      <span class="n">${s.v}</span>
    </div>`).join('');

  const suspect = testRun.results.some(r => r.suspect);
  $('resultNote').innerHTML = suspect
    ? 'Some of that looked rushed or interrupted, so treat it lightly. Worth trying again when you can give it a clear run.'
    : 'The score is your ability to spot the cities <em>and</em> hold back on the mountains, on a 0&ndash;100 scale. Anything above about 60 is solid.';

  if (top && (!all || all.id === top.soundId)) {
    settings.sound = top.soundId;
    store.saveSettings(settings);
    store.updateUser({ recommended: top.soundId });
  }

  testRun = null;
  go('testresult');
}

/* ================================================================
   Patterns
   ================================================================ */

function renderPatterns() {
  const body = $('patternsBody');
  const sessions = store.getSessions().filter(s => s.outcome !== 'abandoned');
  const rated = sessions.filter(s => s.rating);
  const tests = store.getTests();

  if (sessions.length < 3) {
    body.innerHTML = `
      <div class="card stack-sm">
        <h3>Not much to show yet</h3>
        <p class="small">You&rsquo;ve logged ${sessions.length} session${sessions.length === 1 ? '' : 's'}.
        After about five, patterns start to become worth looking at.</p>
      </div>
      <button class="btn btn-ghost" data-back="home">Back</button>`;
    wireBacks();
    return;
  }

  // The three-way comparison this whole project is about.
  const best = bestTestedSound();
  const minutesBy = {}, ratingBy = {};
  for (const s of sessions) minutesBy[s.soundId] = (minutesBy[s.soundId] || 0) + (s.actualMinutes || 0);
  for (const s of rated) (ratingBy[s.soundId] = ratingBy[s.soundId] || []).push(s.rating);

  const mostUsed = Object.entries(minutesBy).sort((a, b) => b[1] - a[1])[0];
  const avgRating = Object.entries(ratingBy)
    .filter(([, xs]) => xs.length >= 2)
    .map(([id, xs]) => ({ id, v: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length }))
    .sort((a, b) => b.v - a.v);

  const nm = id => audio.soundById(id).name;
  const famOf = id => audio.soundById(id).family;
  const dot = id => id
    ? `<span class="fam-dot" style="background:${audio.FAMILY_COLORS[famOf(id)] || 'var(--accent)'}"></span>`
    : '';

  const bestId = best ? best.id : null;
  const mostUsedId = mostUsed ? mostUsed[0] : null;
  const topRatedId = avgRating.length ? avgRating[0].id : null;
  const allMatch = bestId && mostUsedId && topRatedId &&
    bestId === mostUsedId && mostUsedId === topRatedId;

  let html = `<div class="verdict${allMatch ? ' match' : ''}">
    <div class="verdict-row"><span class="k">Tested best</span><span class="v">${dot(bestId)}${bestId ? nm(bestId) : 'Test 2 sounds'}</span></div>
    <div class="verdict-row"><span class="k">Most used</span><span class="v">${dot(mostUsedId)}${mostUsedId ? nm(mostUsedId) : '—'}</span></div>
    <div class="verdict-row"><span class="k">Highest rated</span><span class="v">${dot(topRatedId)}${topRatedId ? nm(topRatedId) : 'Rate a few more'}</span></div>
  </div>`;

  if (allMatch) {
    html += `<div class="notice notice-good">All three agree — <strong>${nm(bestId)}</strong> really is your sound.</div>`;
  }

  if (best && mostUsed && best.id !== mostUsed[0]) {
    html += `<div class="notice notice-warn">Interesting &mdash; you study most with
      <strong>${nm(mostUsed[0])}</strong>, but you concentrate better with
      <strong>${nm(best.id)}</strong>. Worth giving it a proper go for a week.</div>`;
  }

  if (avgRating.length) {
    html += `<div class="stack-sm"><span class="label">How you rated each sound</span><div class="bars">` +
      avgRating.map(r => `
        <div class="bar-row">
          <span>${nm(r.id)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(r.v / 5) * 100}%;background:${audio.FAMILY_COLORS[famOf(r.id)] || 'var(--accent)'}"></span></span>
          <span class="n">${r.v.toFixed(1)}</span>
        </div>`).join('') + `</div></div>`;
  }

  const totalMin = Object.values(minutesBy).reduce((a, b) => a + b, 0);
  html += `<div class="stack-sm"><span class="label">Time spent</span><div class="bars">` +
    Object.entries(minutesBy).sort((a, b) => b[1] - a[1]).map(([id, m]) => `
      <div class="bar-row">
        <span>${nm(id)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(m / Math.max(1, totalMin)) * 100}%;background:${audio.FAMILY_COLORS[famOf(id)] || 'var(--accent)'}"></span></span>
        <span class="n">${fmtMins(m)}</span>
      </div>`).join('') + `</div></div>`;

  if (tests.length) {
    html += `<div class="stack-sm"><span class="label">Test scores</span><div class="bars">` +
      Object.entries(tests.reduce((acc, t) => {
        (acc[t.soundId] = acc[t.soundId] || []).push(t.focusScore); return acc;
      }, {})).map(([id, xs]) => {
        const v = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
        return `<div class="bar-row">
          <span>${nm(id)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${v}%;background:${audio.FAMILY_COLORS[famOf(id)] || 'var(--accent)'}"></span></span>
          <span class="n">${v}</span></div>`;
      }).join('') + `</div></div>`;
  }

  html += `<div class="stack-sm"><span class="label">Recent sessions</span><div class="card">` +
    sessions.slice(-15).reverse().map(s => `
      <div class="session-item">
        <div>
          <div class="what">${nm(s.soundId)} · ${Math.round(s.actualMinutes)} min</div>
          <div class="when">${new Date(s.startedAt).toLocaleString([], {
            weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>
        </div>
        <div class="score">${s.rating ? s.rating + '/5' : '—'}</div>
      </div>`).join('') + `</div></div>`;

  html += `<button class="btn btn-ghost" data-back="home">Back</button>`;
  body.innerHTML = html;
  wireBacks();
}

/* ================================================================
   Settings
   ================================================================ */

/* Shown on the Credits screen. Keep in step with audio/CREDITS.txt.
   If you swap a track, change it here too -- a CC BY track credited to
   the wrong artist is worse than no credit at all. */
const MUSIC_CREDITS = {
  classical: {
    title: 'Ballade No. 1 in G minor, Op. 23',
    by: 'Frédéric Chopin, performed by Frank Levy',
    source: 'Musopen',
    licence: 'Public domain recording'
  },
  lyrical: {
    title: 'Every Time',
    by: 'Katy Kirby',
    source: 'Free Music Archive',
    licence: 'CC BY'
  }
};

function renderSettings() {
  $('setNickname').textContent = user ? user.nickname : '—';
  $('setJoined').textContent = user
    ? `Joined ${new Date(user.joined).toLocaleDateString()}`
    : '';
  const pending = store.pendingCount();
  $('setSync').textContent = store.mode === 'cloud'
    ? (pending ? `${pending} record${pending === 1 ? '' : 's'} waiting to sync` : 'Everything is synced')
    : 'Saved on this device only';

  $('setTipi').textContent = (user && user.tipi)
    ? 'Retake the personality check'
    : 'Take the personality check (optional)';

  const music = audio.SOUNDS.filter(s => s.file);
  Promise.all(music.map(audio.fileAvailable)).then(av => {
    const added = music.filter((_, i) => av[i]);
    // CC BY requires the credit to be SHOWN, not just shipped in a file
    // next to the audio. So the attribution lives here, on screen.
    $('creditMusic').innerHTML = added.length
      ? added.map(s => {
          const c = MUSIC_CREDITS[s.id];
          if (!c) return `<strong>${s.name}</strong> — see audio/CREDITS.txt`;
          return `<strong>${c.title}</strong><br>${c.by}<br>
                  <span class="tiny">${c.source} &middot; ${c.licence}</span>`;
        }).join('<br><br>')
      : 'No music tracks have been added yet.';
  });
}

function renderTipi() {
  tipiAnswers = Array(10).fill(0);
  $('tipiSave').disabled = true;

  $('tipiList').innerHTML = TIPI_ITEMS.map((item, i) => `
    <div class="card stack-sm">
      <p class="small" style="color:var(--ink)"><strong>${item.n}.</strong> ${item.text}</p>
      <div class="tipi-row" data-idx="${i}">
        ${[1, 2, 3, 4, 5, 6, 7].map(v =>
          `<button class="rate-btn" data-val="${v}" aria-pressed="false">${v}</button>`
        ).join('')}
      </div>
    </div>`).join('');

  $$('#tipiList .tipi-row').forEach(row => {
    const idx = +row.dataset.idx;
    row.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      tipiAnswers[idx] = +btn.dataset.val;
      row.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      $('tipiSave').disabled = tipiAnswers.some(v => !v);
    }));
  });
}

function installHelp() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  toast(ios
    ? 'Tap the Share button, then "Add to Home Screen".'
    : 'Open the browser menu, then "Install app" or "Add to Home screen".', 6000);
}

/** Native share sheet where available (most phones); falls back to
    copying the link to the clipboard on desktop browsers that don't
    support navigator.share. */
async function shareApp() {
  const url = location.href.split('#')[0].split('?')[0];
  const shareData = {
    title: 'Sound Advice',
    text: 'Find the sound you actually study best to — try Sound Advice, my science fair app:',
    url
  };
  if (navigator.share) {
    try { await navigator.share(shareData); }
    catch (err) { /* person cancelled the share sheet -- nothing to do */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — paste it to share!');
  } catch {
    toast(`Share this link: ${url}`, 6000);
  }
}

/* ================================================================
   Wiring
   ================================================================ */

function wireBacks() {
  $$('[data-back]').forEach(b => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', () => { stopPreview(); go(b.dataset.back); });
  });
}

function wireEverything() {
  wireBacks();

  $('signinBtn').addEventListener('click', doSignIn);
  $('pin').addEventListener('keydown', e => { if (e.key === 'Enter') doSignIn(); });

  $('privacyBtn').addEventListener('click', () => {
    settings.seenPrivacy = true; store.saveSettings(settings); go('onboard');
  });

  $('onboardFull').addEventListener('click', () => {
    settings.seenOnboard = true; store.saveSettings(settings);
    $('silentCard').hidden = !audio.needsSilentSwitchWarning();
    window.__afterCheck = () => beginTest('full');
    go('check');
  });
  $('onboardTipi').addEventListener('click', () => {
    tipiReturnTo = 'onboard';
    go('tipi');
  });
  $('onboardSkip').addEventListener('click', () => {
    settings.seenOnboard = true; store.saveSettings(settings); go('home');
  });

  $('tipiBack').addEventListener('click', () => go(tipiReturnTo));
  $('tipiSkip').addEventListener('click', () => go(tipiReturnTo));
  $('tipiSave').addEventListener('click', async () => {
    const scores = scoreTipi(tipiAnswers);
    user = await store.updateUser({
      tipi: { raw: [...tipiAnswers], scores, takenAt: Date.now() }
    });
    toast('Saved — thanks!');
    go(tipiReturnTo);
  });

  $('beepBtn').addEventListener('click', () => audio.testBeep());
  $('checkDone').addEventListener('click', () => {
    const fn = window.__afterCheck; window.__afterCheck = null;
    fn ? fn() : go('home');
  });

  $('testStart').addEventListener('click', () => runNextBlock());
  $('skipBreak').addEventListener('click', () => {
    clearInterval(ticker); ticker = null; runNextBlock();
  });
  $('resultDone').addEventListener('click', () => go('home'));

  $('soundPicker').addEventListener('click', () => go('sounds'));
  $('shareBtn').addEventListener('click', shareApp);
  $('toSettings').addEventListener('click', () => go('settings'));
  $('toPatterns').addEventListener('click', () => go('patterns'));
  $('toTipiHome').addEventListener('click', () => {
    tipiReturnTo = 'home';
    go('tipi');
  });
  $('toTest').addEventListener('click', () => {
    $('silentCard').hidden = !audio.needsSilentSwitchWarning();
    // Default to the current study sound only if it's one of the four
    // test sounds; otherwise beginTest() falls back to silence, and the
    // testSoundChoice chips let the person switch before starting.
    window.__afterCheck = () => beginTest('single', settings.sound);
    go('check');
  });

  $$('#modeSeg button').forEach(b => b.addEventListener('click', () => {
    settings.mode = b.dataset.mode; store.saveSettings(settings); renderHome();
  }));
  $('workMin').addEventListener('change', e => {
    settings.workMin = Math.max(5, Math.min(90, +e.target.value || 25));
    store.saveSettings(settings); renderHome();
  });
  $('breakMin').addEventListener('change', e => {
    settings.breakMin = Math.max(1, Math.min(30, +e.target.value || 5));
    store.saveSettings(settings);
  });

  $('volume').addEventListener('input', e => {
    settings.volume = e.target.value / 100;
  });
  $('volume').addEventListener('change', e => {
    settings.volume = e.target.value / 100;
    store.saveSettings(settings);
    audio.setVolume(settings.volume);
  });
  $('tone').addEventListener('change', e => {
    settings.tone = e.target.value / 100;
    store.saveSettings(settings);
    audio.setTone(settings.tone);
    renderSounds();
  });

  $('startBtn').addEventListener('click', startSession);
  $('pauseBtn').addEventListener('click', togglePause);
  $('finishBtn').addEventListener('click', () => endSession('ended_early'));
  $('abandonBtn').addEventListener('click', () => endSession('abandoned'));

  $$('#rateRow .rate-btn').forEach(b => b.addEventListener('click', () => {
    rating.score = +b.dataset.rate;
    $$('#rateRow .rate-btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('rateSave').disabled = false;
  }));
  $$('#tagRow .tag-btn').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    const on = b.getAttribute('aria-pressed') === 'true';
    b.setAttribute('aria-pressed', String(!on));
    rating.tags = on ? rating.tags.filter(x => x !== t) : [...rating.tags, t];
  }));
  $('rateSave').addEventListener('click', () => saveRating(false));
  $('rateSkip').addEventListener('click', () => saveRating(true));

  $('setRetake').addEventListener('click', () => {
    $('silentCard').hidden = !audio.needsSilentSwitchWarning();
    window.__afterCheck = () => beginTest('full');
    go('check');
  });
  $('setTipi').addEventListener('click', () => {
    tipiReturnTo = 'settings';
    go('tipi');
  });
  $('setCredits').addEventListener('click', () => go('credits'));
  $('setInstall').addEventListener('click', installHelp);
  $('setShare').addEventListener('click', shareApp);
  $('setSignOut').addEventListener('click', () => {
    store.signOut(); user = null; go('signin');
  });
  $('setDelete').addEventListener('click', async () => {
    if (!confirm('Delete your account and every session and score? This cannot be undone.')) return;
    await store.deleteEverything();
    user = null;
    settings = store.getSettings();
    toast('All gone.');
    go('signin');
  });

  window.addEventListener('online', () => store.flushQueue().then(updateSyncDot));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { tick(); updateSyncDot(); }
  });
  window.addEventListener('beforeunload', e => {
    if (session) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
