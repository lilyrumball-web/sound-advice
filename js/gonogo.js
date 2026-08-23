/* Sound Advice — concentration test
   ---------------------------------------------------------------
   A gradual-onset go/no-go task, MODELLED ON the GradCPT paradigm
   (Esterman & DeGutis; see Fortenbaugh et al., 2015). The GradCPT
   itself belongs to the Boston Attention Lab and is distributed by
   The Many Brains Project -- this is an independent implementation
   of the same idea, not that instrument.

   Core timing follows the published task: 800 ms from one image being
   fully coherent to the next being fully coherent, and mountains on
   10% of trials. Both matter. Slowing the task down or making the
   mountains more frequent makes it easier, and an easier task pushes
   everybody towards a perfect score -- which leaves no room to see a
   difference between one sound and another. Two people in the 2025
   pilot already scored 100% on the go trials.

   Because 800 ms is shorter than a slow reaction time, a press can
   land after the next picture has appeared. assignPresses() below
   handles that, in the spirit of the original's fitting procedure.

   The scenes themselves are grayscale photographs of cities and
   mountains, prepared by tools/prepare-scenes.py: square-cropped,
   desaturated, and matched so every image has the same mean luminance
   and the same RMS contrast. That matching is not cosmetic. Every
   trial is a dissolve from one scene into the next, so a photo that
   is brighter or punchier than its neighbours would make its own
   trials easier -- a difference in the data owing to the picture
   rather than to the sound being tested.
   --------------------------------------------------------------- */

const TRIAL_MS = 800;      // as published; do not slow this down
const WARMUP_TRIALS = 3;   // shown but not scored
const MIN_RT = 250;        // see assignPresses()
const SCENES_DIR = './scenes/';

/* ---------- reproducible randomness ---------- */

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- the scenes ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // Decode up front. Otherwise the very first drawImage of a picture
      // decodes on the main thread mid-trial, and a dropped frame during
      // a 1.2 s window is a dropped frame in someone's reaction time.
      if (img.decode) img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

let scenePromise = null;

/**
 * Load and decode every scene. Safe to call repeatedly -- the work happens
 * once and later callers get the same promise. Called on a cold start so
 * the images are ready long before anyone opens the test.
 */
export function buildScenes() {
  if (scenePromise) return scenePromise;

  scenePromise = (async () => {
    const res = await fetch(`${SCENES_DIR}manifest.json`);
    if (!res.ok) throw new Error(`scenes/manifest.json is missing (HTTP ${res.status})`);
    const manifest = await res.json();

    const load = names => Promise.all(names.map(n => loadImage(SCENES_DIR + n)));
    const [city, mountain] = await Promise.all([
      load(manifest.city || []),
      load(manifest.mountain || [])
    ]);

    if (city.length < 2 || mountain.length < 2) {
      throw new Error('Need at least two city and two mountain scenes');
    }
    return { city, mountain };
  })();

  // A failed load must not poison every later attempt -- someone who opens
  // the app on no signal should be able to try again once they have some.
  scenePromise.catch(() => { scenePromise = null; });
  return scenePromise;
}

/* ---------- the trial list ---------- */

function makeSequence(total, noGoRate, rnd) {
  const seq = new Array(total).fill('city');
  const want = Math.round((total - WARMUP_TRIALS) * noGoRate);
  let placed = 0, guard = 0;

  while (placed < want && guard++ < total * 60) {
    const i = WARMUP_TRIALS + Math.floor(rnd() * (total - WARMUP_TRIALS));
    // No-go trials never sit next to each other -- the paradigm needs
    // them to be rare and unpredictable.
    if (seq[i] === 'mountain') continue;
    if (seq[i - 1] === 'mountain' || seq[i + 1] === 'mountain') continue;
    seq[i] = 'mountain';
    placed++;
  }
  return seq;
}

/* ---------- turning taps into responses ----------

   At 800 ms per image, a slow tap can arrive after the next picture is
   already on screen. Scoring it against whatever happens to be showing
   would count it against the wrong image -- and if that image is a
   mountain, an honest slow response gets recorded as a false alarm.
   False alarms are the whole measure here, so that would matter.

   The original paper solves this with an iterative fitting algorithm
   and reports that under 5% of trials need it. This is a simpler,
   deliberately conservative version, using two rules:

   1. Two taps inside one window: the first almost certainly belonged
      to the previous image. Hand it back, if that image has no tap.
   2. A tap in the first 250 ms of a window: nobody sees a picture and
      reacts to it that fast, so it is a late response to the picture
      before. Hand it back, again only if that one is empty.

   Both rules only ever move a tap to a trial with no response, so no
   response is ever invented or deleted. How many were moved is
   reported alongside the results, so it can be checked rather than
   taken on trust.
*/
export function assignPresses(pressTimes, trials) {
  const windows = new Map();          // trial index -> [press times]
  for (const t of pressTimes) {
    const k = Math.floor(t / TRIAL_MS);
    if (k < 0 || k >= trials.length) continue;
    if (!windows.has(k)) windows.set(k, []);
    windows.get(k).push(t);
  }

  const empty = k => k >= 0 && !(windows.get(k) || []).length;
  let moved = 0;

  for (const k of [...windows.keys()].sort((a, b) => a - b)) {
    const list = windows.get(k);

    // Rule 1 -- a doubled-up window.
    if (list.length > 1 && empty(k - 1)) {
      windows.set(k - 1, [list.shift()]);
      moved++;
      continue;
    }
    // Rule 2 -- impossibly fast, so it belongs to the image before.
    if (list.length === 1 && (list[0] - k * TRIAL_MS) < MIN_RT && empty(k - 1)) {
      windows.set(k - 1, [list.shift()]);
      windows.set(k, []);
      moved++;
    }
  }

  for (const [k, list] of windows) {
    if (!list.length) continue;
    const t = Math.min(...list);      // fastest response wins
    trials[k].pressed = true;
    trials[k].rt = Math.round(t - k * TRIAL_MS);
  }
  return moved;
}

/* ---------- statistics ---------- */

// Inverse normal CDF (Acklam's rational approximation, ~1e-9 accurate).
function probit(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q /
         (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

export function score(trials) {
  const scored = trials.filter(t => !t.warmup);
  const go = scored.filter(t => t.kind === 'city');
  const nogo = scored.filter(t => t.kind === 'mountain');

  const hits = go.filter(t => t.pressed).length;
  const misses = go.length - hits;
  const falseAlarms = nogo.filter(t => t.pressed).length;
  const correctRejections = nogo.length - falseAlarms;

  // Loglinear correction (Hautus, 1995): add 0.5 to each count and 1 to
  // each total BEFORE turning them into rates. Without this, anyone who
  // gets every go-trial right produces an infinite d-prime -- which is
  // exactly what happened to two participants in the 2025 pilot.
  const hitRate = (hits + 0.5) / (go.length + 1);
  const faRate = (falseAlarms + 0.5) / (nogo.length + 1);
  const dprime = probit(hitRate) - probit(faRate);
  const criterion = -0.5 * (probit(hitRate) + probit(faRate));

  const rts = go.filter(t => t.pressed).map(t => t.rt).sort((a, b) => a - b);
  const mean = rts.length ? rts.reduce((s, v) => s + v, 0) / rts.length : null;
  const median = rts.length ? rts[Math.floor(rts.length / 2)] : null;
  const sd = rts.length > 1
    ? Math.sqrt(rts.reduce((s, v) => s + (v - mean) ** 2, 0) / (rts.length - 1))
    : null;

  return {
    trials: scored.length,
    goTrials: go.length,
    noGoTrials: nogo.length,
    hits, misses, falseAlarms, correctRejections,
    accuracy: +((hits + correctRejections) / scored.length).toFixed(4),
    goAccuracy: +(hits / go.length).toFixed(4),
    nogoAccuracy: +(correctRejections / nogo.length).toFixed(4),
    meanRT: mean === null ? null : Math.round(mean),
    medianRT: median === null ? null : Math.round(median),
    sdRT: sd === null ? null : Math.round(sd),
    cvRT: sd === null || !mean ? null : +(sd / mean).toFixed(4),
    dprime: +dprime.toFixed(4),
    criterion: +criterion.toFixed(4),
    // A 0-100 presentation of d-prime, where 4.5 is treated as the
    // practical ceiling. Purely for showing the user a friendly number;
    // every analysis should use d-prime itself.
    focusScore: Math.max(0, Math.min(100, Math.round((dprime / 4.5) * 100)))
  };
}

/* ---------- running a block ---------- */

function waitingMessage(canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#8b93a1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(canvas.height / 26)}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Run one block of the test.
 * Resolves with { stats, trials, quality } once the block finishes.
 * Rejects if the scene photographs cannot be loaded -- deliberately, rather
 * than quietly falling back to something else to draw. Half the users doing
 * a different task from the other half would be far worse than a failed run.
 */
export async function runBlock({ canvas, totalTrials = 187, noGoRate = 0.10, seed = 1, onProgress }) {
  {
    // Size the canvas before anything is drawn on it, so the loading
    // message lands in the middle rather than in a corner.
    const dpr0 = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr0;
    canvas.height = canvas.clientHeight * dpr0;
    waitingMessage(canvas, 'Loading…');
  }

  // Normally already resolved -- the scenes start loading when the app boots.
  const scenes = await buildScenes();

  return new Promise(resolve => {
    const rnd = seeded(seed);
    const seq = makeSequence(totalTrials, noGoRate, rnd);

    // Pick which picture each trial uses, never repeating back to back.
    const picks = [];
    let lastCity = -1, lastMt = -1;
    for (const kind of seq) {
      const pool = kind === 'city' ? scenes.city : scenes.mountain;
      let i, last = kind === 'city' ? lastCity : lastMt;
      do { i = Math.floor(rnd() * pool.length); } while (i === last && pool.length > 1);
      if (kind === 'city') lastCity = i; else lastMt = i;
      picks.push(pool[i]);
    }

    const trials = seq.map((kind, i) => ({
      index: i, kind, warmup: i < WARMUP_TRIALS, pressed: false, rt: null
    }));

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    size();
    window.addEventListener('resize', size);

    let awayCount = 0, awayMs = 0, awaySince = null;
    const onVisibility = () => {
      if (document.hidden) { awaySince = performance.now(); awayCount++; }
      else if (awaySince) { awayMs += performance.now() - awaySince; awaySince = null; }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const start = performance.now();
    const totalMs = totalTrials * TRIAL_MS;
    let done = false;

    // Taps are recorded raw and only matched to images once the block
    // is over, so a slow response can still be given to the right one.
    const pressTimes = [];
    function press(ev) {
      if (done) return;
      if (ev.type === 'keydown' && ev.code !== 'Space') return;
      ev.preventDefault();
      pressTimes.push(performance.now() - start);
    }

    canvas.addEventListener('pointerdown', press);
    window.addEventListener('keydown', press);

    function frame() {
      if (done) return;
      const t = performance.now() - start;
      if (t >= totalMs) return finish();

      const k = Math.floor(t / TRIAL_MS);
      const frac = (t % TRIAL_MS) / TRIAL_MS;
      const w = canvas.width, h = canvas.height;
      const side = Math.min(w, h);
      const x = (w - side) / 2, y = (h - side) / 2;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.drawImage(picks[k], x, y, side, side);
      if (k + 1 < picks.length) {
        ctx.globalAlpha = frac;                   // dissolve into the next
        ctx.drawImage(picks[k + 1], x, y, side, side);
        ctx.globalAlpha = 1;
      }

      if (onProgress) onProgress(t / totalMs, Math.ceil((totalMs - t) / 1000));
      requestAnimationFrame(frame);
    }

    function finish() {
      done = true;
      canvas.removeEventListener('pointerdown', press);
      window.removeEventListener('keydown', press);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', size);
      if (awaySince) awayMs += performance.now() - awaySince;

      const reassigned = assignPresses(pressTimes, trials);
      const stats = score(trials);
      resolve({
        stats,
        trials: trials.map(t => ({ i: t.index, k: t.kind[0], p: t.pressed ? 1 : 0, rt: t.rt })),
        quality: {
          leftTaskCount: awayCount,
          leftTaskMs: Math.round(awayMs),
          totalPresses: pressTimes.length,
          reassignedPresses: reassigned,
          suspect: stats.accuracy < 0.6 || awayMs > 15000
        }
      });
    }

    requestAnimationFrame(frame);
  });
}

export const TEST_SECONDS = trials => Math.round((trials * TRIAL_MS) / 1000);
