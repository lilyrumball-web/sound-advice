/* Sound Advice — concentration test
   ---------------------------------------------------------------
   A gradual-onset go/no-go task, MODELLED ON the GradCPT paradigm
   (Esterman & DeGutis; see Fortenbaugh et al., 2015). The GradCPT
   itself belongs to the Boston Attention Lab and is distributed by
   The Many Brains Project -- this is an independent implementation
   of the same idea, not that instrument.

   Two deliberate differences, both worth stating in the write-up:

   1. The scenes are drawn by code rather than being photographs.
      That means nothing has to be downloaded (this runs on phones,
      on mobile data) and every user sees exactly the same set.
   2. Each image is fully sharp at the start of its 1.2 s window and
      dissolves into the next across it, so a press can be attributed
      to one image without needing the original's fitting procedure.
   --------------------------------------------------------------- */

const TRIAL_MS = 1200;
const WARMUP_TRIALS = 3;   // shown but not scored
const SCENE_PX = 600;

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

function newScene() {
  const c = document.createElement('canvas');
  c.width = c.height = SCENE_PX;
  return c;
}

function sky(ctx, rnd, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, SCENE_PX);
  g.addColorStop(0, `hsl(210 8% ${top}%)`);
  g.addColorStop(1, `hsl(210 8% ${bottom}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCENE_PX, SCENE_PX);
  // A few clouds, so the sky is never a flat field.
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(rnd() * SCENE_PX, rnd() * SCENE_PX * 0.5,
                60 + rnd() * 130, 14 + rnd() * 26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCity(rnd) {
  const c = newScene(), ctx = c.getContext('2d');
  sky(ctx, rnd, 62, 40);

  const layers = [{ shade: 26, y: 0.60, w: 46 }, { shade: 17, y: 0.68, w: 62 }];
  for (const L of layers) {
    let x = -20;
    while (x < SCENE_PX + 20) {
      const w = L.w * (0.55 + rnd() * 0.95);
      const h = SCENE_PX * (0.16 + rnd() * 0.34);
      const top = SCENE_PX * L.y + (rnd() - 0.5) * 40 - h * 0.35;
      ctx.fillStyle = `hsl(210 10% ${L.shade}%)`;
      ctx.fillRect(x, top, w, SCENE_PX - top);

      if (rnd() > 0.72) {                          // spire
        ctx.fillRect(x + w / 2 - 2, top - 26 - rnd() * 34, 4, 30);
      }
      // Lit windows
      ctx.fillStyle = `hsl(45 22% ${L.shade + 44}%)`;
      for (let wy = top + 12; wy < SCENE_PX - 10; wy += 15) {
        for (let wx = x + 6; wx < x + w - 7; wx += 12) {
          if (rnd() > 0.55) ctx.fillRect(wx, wy, 5, 7);
        }
      }
      x += w + 3 + rnd() * 8;
    }
  }
  ctx.fillStyle = 'hsl(210 10% 12%)';
  ctx.fillRect(0, SCENE_PX * 0.94, SCENE_PX, SCENE_PX);
  return c;
}

function drawMountain(rnd) {
  const c = newScene(), ctx = c.getContext('2d');
  sky(ctx, rnd, 60, 42);

  const ridges = [{ shade: 40, base: 0.70, hi: 0.30 },
                  { shade: 28, base: 0.80, hi: 0.40 },
                  { shade: 18, base: 0.92, hi: 0.52 }];

  for (const R of ridges) {
    ctx.fillStyle = `hsl(210 9% ${R.shade}%)`;
    ctx.beginPath();
    ctx.moveTo(-10, SCENE_PX);
    let x = -10;
    const baseY = SCENE_PX * R.base;
    while (x < SCENE_PX + 10) {
      const peakW = 90 + rnd() * 150;
      const peakH = SCENE_PX * R.hi * (0.55 + rnd() * 0.9);
      ctx.lineTo(x + peakW / 2, baseY - peakH);
      ctx.lineTo(x + peakW, baseY - peakH * (0.1 + rnd() * 0.3));
      x += peakW;
    }
    ctx.lineTo(SCENE_PX + 10, SCENE_PX);
    ctx.closePath();
    ctx.fill();

    if (R.shade < 30) {                            // snow on the near ridge
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'hsl(210 6% 74%)';
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, 0, SCENE_PX, baseY - SCENE_PX * R.hi * 0.55);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
  return c;
}

let sceneCache = null;

export function buildScenes() {
  if (sceneCache) return sceneCache;
  const rnd = seeded(20260822);
  sceneCache = {
    city: Array.from({ length: 12 }, () => drawCity(rnd)),
    mountain: Array.from({ length: 8 }, () => drawMountain(rnd))
  };
  return sceneCache;
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

/**
 * Run one block of the test.
 * Resolves with { stats, trials, quality } once the block finishes.
 */
export function runBlock({ canvas, totalTrials = 125, noGoRate = 0.16, seed = 1, onProgress }) {
  return new Promise(resolve => {
    const scenes = buildScenes();
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

    function press(ev) {
      if (done) return;
      if (ev.type === 'keydown' && ev.code !== 'Space') return;
      ev.preventDefault();
      const t = performance.now() - start;
      const k = Math.floor(t / TRIAL_MS);
      if (k < 0 || k >= trials.length) return;
      if (trials[k].pressed) return;              // only the first press counts
      trials[k].pressed = true;
      trials[k].rt = Math.round(t - k * TRIAL_MS);
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

      const stats = score(trials);
      resolve({
        stats,
        trials: trials.map(t => ({ i: t.index, k: t.kind[0], p: t.pressed ? 1 : 0, rt: t.rt })),
        quality: {
          leftTaskCount: awayCount,
          leftTaskMs: Math.round(awayMs),
          suspect: stats.accuracy < 0.6 || awayMs > 15000
        }
      });
    }

    requestAnimationFrame(frame);
  });
}

export const TEST_SECONDS = trials => Math.round((trials * TRIAL_MS) / 1000);
