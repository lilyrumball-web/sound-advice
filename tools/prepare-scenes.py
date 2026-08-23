#!/usr/bin/env python3
"""
Sound Advice - prepare the concentration-test scenes.

Turns a folder of ordinary colour photographs into the matched set of
grayscale scenes the go/no-go test needs.

    python3 tools/prepare-scenes.py ~/Downloads/cities ~/Downloads/mountains

Why each step exists
--------------------
* Square crop, centred on where the detail actually is, so a photo whose
  subject sits low in the frame (a distant skyline under a big sky) does
  not get cropped down to empty sky.
* Grayscale, because colour is a low-level cue. If cities were warm and
  mountains were blue, people would learn to respond to the colour and
  the test would stop measuring scene recognition.
* Luminance and contrast matched across the WHOLE set. Every trial is a
  dissolve from one scene into the next, so a photo that is brighter or
  punchier than its neighbours makes its own trials easier than the rest
  - a difference in the data that has nothing to do with the sound being
  tested. Matching the mean and standard deviation of every image kills
  that confound.

Re-run this whenever you add or replace a photo. It rewrites the whole
scenes/ folder, so the matching is always computed across the current set.

IMPORTANT: check any new photo for a watermark before adding it.
Unsplash's paid tier ("Unsplash+") tiles faint text across the image that
is nearly invisible on screen but very visible once contrast is matched.
"""

import json
import os
import sys

import numpy as np
from PIL import Image

SIZE = 600           # px, square. Matches SCENE_PX in js/gonogo.js
TARGET_MEAN = 128.0  # mid-grey
TARGET_SD = 45.0     # RMS contrast; see clipping report below
JPEG_QUALITY = 82   # grayscale photos; 82 is visually identical to 95 here
                    # and roughly halves what a phone has to download

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scenes')
EXTS = {'.jpg', '.jpeg', '.png', '.avif', '.webp', '.heic', '.tif', '.tiff'}


def load_grey(path):
    """Open anything and return a float32 grayscale array."""
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGB')
    return np.asarray(im.convert('L')).astype(np.float32)


def square_crop(a):
    """Crop to a square window centred on the busiest part of the frame.

    'Busiest' = the centroid of edge energy. On a skyline photo that pulls
    the window down towards the buildings instead of leaving it in the sky;
    on a normal landscape it barely moves off centre.
    """
    h, w = a.shape
    side = min(h, w)
    if h == w:
        return a

    gy, gx = np.gradient(a)
    energy = np.abs(gx) + np.abs(gy)

    if w > h:                                  # landscape: choose x
        profile = energy.sum(axis=0)
        centre = float((profile * np.arange(w)).sum() / max(profile.sum(), 1e-6))
        x0 = int(round(centre - side / 2))
        x0 = max(0, min(w - side, x0))
        return a[:, x0:x0 + side]

    profile = energy.sum(axis=1)               # portrait: choose y
    centre = float((profile * np.arange(h)).sum() / max(profile.sum(), 1e-6))
    y0 = int(round(centre - side / 2))
    y0 = max(0, min(h - side, y0))
    return a[y0:y0 + side, :]


def resize(a, size=SIZE):
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode='L')
    return np.asarray(im.resize((size, size), Image.LANCZOS)).astype(np.float32)


def collect(folder):
    if not os.path.isdir(folder):
        sys.exit(f'Not a folder: {folder}')
    names = [n for n in sorted(os.listdir(folder))
             if os.path.splitext(n)[1].lower() in EXTS and not n.startswith('.')]
    return [os.path.join(folder, n) for n in names]


def prepare(paths, kind):
    """Crop, grey and resize every photo, then match the set statistics."""
    stages = []
    for p in paths:
        try:
            a = resize(square_crop(load_grey(p)))
        except Exception as exc:                       # noqa: BLE001
            print(f'  ! skipped {os.path.basename(p)}: {exc}')
            continue
        stages.append((p, a))

    out = []
    for i, (p, a) in enumerate(stages, start=1):
        mean, sd = float(a.mean()), float(a.std())
        # Rescale so every image has the same mean and the same RMS contrast.
        scaled = (a - mean) * (TARGET_SD / max(sd, 1e-6)) + TARGET_MEAN
        clipped = float(((scaled < 0) | (scaled > 255)).mean())
        final = np.clip(scaled, 0, 255).astype(np.uint8)

        name = f'{kind}-{i:02d}.jpg'
        Image.fromarray(final, mode='L').save(
            os.path.join(OUT_DIR, name), 'JPEG',
            quality=JPEG_QUALITY, optimize=True, subsampling=0)

        out.append((name, os.path.basename(p)))
        flag = '  <-- lots of clipping, consider replacing' if clipped > 0.02 else ''
        print(f'  {name}  from {os.path.basename(p)[:38]:38s} '
              f'was mean {mean:5.1f} sd {sd:5.1f}   clipped {clipped * 100:4.1f}%{flag}')
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit('usage: prepare-scenes.py <cities-folder> <mountains-folder>')

    os.makedirs(OUT_DIR, exist_ok=True)
    for old in os.listdir(OUT_DIR):
        if old.endswith('.jpg'):
            os.remove(os.path.join(OUT_DIR, old))

    print('Cities (go trials)')
    city = prepare(collect(sys.argv[1]), 'city')
    print('\nMountains (no-go trials)')
    mountain = prepare(collect(sys.argv[2]), 'mountain')

    if not city or not mountain:
        sys.exit('\nNeed at least one of each. Nothing written.')

    manifest = {
        'size': SIZE,
        'targetMean': TARGET_MEAN,
        'targetSd': TARGET_SD,
        'city': [n for n, _ in city],
        'mountain': [n for n, _ in mountain],
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
        fh.write('\n')

    # Which original photo became which scene. Regenerated every run, so
    # it is always right; fill in the actual sources in scenes/CREDITS.txt.
    with open(os.path.join(OUT_DIR, 'SOURCES.txt'), 'w') as fh:
        fh.write('Scene file            Original photo\n')
        fh.write('--------------------  ' + '-' * 40 + '\n')
        for name, src in city + mountain:
            fh.write(f'{name:20s}  {src}\n')

    total = sum(os.path.getsize(os.path.join(OUT_DIR, n))
                for n, _ in city + mountain)
    print(f'\n{len(city)} cities + {len(mountain)} mountains, '
          f'{total / 1024:.0f} KB total, written to scenes/')
    print('sw.js caches whatever manifest.json lists, so there is no file '
          'list to update -\nbut still bump CACHE in sw.js, or phones will '
          'keep serving the old images.')


if __name__ == '__main__':
    main()
