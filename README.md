# Sound Advice

A study app that helps you find the sound you actually concentrate best
to — and then checks whether that's really the one you end up using.

Built for a 2026 science fair project, following a 2025 pilot study
which found that people are poor judges of what helps their own
concentration: only 3 of 7 participants correctly predicted which of
four sounds they would perform best with.

**Setting it up: see [SETUP.md](SETUP.md).**

---

## What it does

- **A library of study sounds** — white, pink and brown noise (with a
  tone slider), rain, stream, ocean, forest, fireplace, silence, and two
  optional music tracks.
- **A built-in concentration test** — a gradual-onset go/no-go task that
  measures sustained attention under each sound and ranks them for you.
- **A study timer** — Pomodoro with adjustable lengths, or a free-running
  stopwatch.
- **Session ratings** — one tap out of five, plus an optional tag for
  what got in the way.
- **Your patterns** — the sound that tested best, the sound you use most,
  and the sound you rate highest, side by side. When those three
  disagree, that's the finding.
- **A results dashboard** for the researcher, with CSV export.

---

## How it's built

Plain HTML, CSS and JavaScript. No framework and no build step — you can
read every line, and there is nothing to install to work on it.

```
index.html          all the screens
admin.html          pooled results dashboard (access code required)
styles.css
firebase-config.js  your Firebase settings go here
manifest.json       makes it installable as an app
sw.js               offline support
js/audio.js         sound synthesis and playback
js/gonogo.js        the concentration test
js/store.js         local storage and cloud sync
js/app.js           screens, timer, test flow, patterns
icons/              app icons
audio/              optional music tracks + credits
```

---

## Three decisions worth understanding

If a judge asks how it works, these are the interesting answers.

### The sounds are generated, not recorded

Everything except the two music tracks is synthesised from filtered
noise inside the browser. Rain is mid-range noise plus a low rumble plus
150 scattered droplet transients. Ocean is brown noise shaped by a slow
swell. Fire is a low roar plus random crackles.

Three things fall out of that: no licensing questions, nothing to
download, and every user hears an identical sound.

But it can't be synthesised *live*, because phones suspend the audio
engine the moment the screen locks — precisely when a studying person
puts their phone down. So each sound is rendered once into a 22-second
loop, crossfaded at the seam so the join is inaudible, and handed to the
ordinary audio player, which phones are happy to keep playing in the
background.

### The timer never counts ticks

Phone browsers throttle and freeze timers in backgrounded tabs. A timer
built by counting intervals would quietly under-report every session
where someone locked their phone.

Elapsed time is always computed as `now − start − paused`, straight from
the system clock, so it stays correct no matter what the browser did
while you weren't looking.

### d′ is corrected before it's reported

The test's main measure is d′ (d-prime) — how well you tell cities from
mountains, separated from how trigger-happy you are.

Someone who gets *every* go-trial right produces a hit rate of exactly
1.0, and the z-score of 1.0 is infinity. Two of the seven participants in
the 2025 pilot did exactly that. The loglinear correction (Hautus, 1995)
adds 0.5 to each count and 1 to each total before converting to rates, so
a perfect performer scores very highly instead of breaking the analysis.

---

## What gets stored

No names, no emails. A nickname and a PIN, and the PIN is only ever
stored as a SHA-256 hash.

- **user** — nickname, PIN hash, joined date, device type, recommended sound
- **session** — start and end time, planned and actual minutes, mode,
  sound, volume, rating, tags, outcome (completed / ended early /
  abandoned), times the app was left
- **test** — sound, date, full or single, accuracy, hits, misses, false
  alarms, correct rejections, mean/median/SD of reaction time, d′,
  criterion, focus score, plus trial-level responses

Abandoned sessions are kept rather than discarded. "People give up more
often with lyrical music" is a real possible finding, and it only shows
up if the failures are in the data.

Everything is written to the device first and synced afterwards, so a
session is never lost to bad wifi. Anyone can delete all of their own
data from Settings.

---

## Credits

The concentration test is **modelled on** the Gradual Onset Continuous
Performance Test (GradCPT), developed by the Boston Attention Lab and
distributed by The Many Brains Project. This is an independent
implementation of the paradigm, not that instrument. Two deliberate
differences: the scenes are drawn by code rather than photographed, and
each image is fully sharp at the start of its 1.2-second window rather
than using the original's response-fitting procedure.

Fortenbaugh, F. C., DeGutis, J., Germine, L., Wilmer, J. B., Grosso, M.,
Russo, K., & Esterman, M. (2015). Sustained Attention Across the Life
Span in a Sample of 10,000. *Psychological Science*, 26(9), 1497–1510.

Hautus, M. J. (1995). Corrections for extreme proportions and their
biasing effects on estimated values of d′. *Behavior Research Methods,
Instruments, & Computers*, 27, 46–51.
