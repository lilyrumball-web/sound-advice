# Setting up Sound Advice

Two accounts to create, both free, both about ten minutes. Do GitHub
first — it gets the app onto the internet, and you can test everything
on your phone before you touch Firebase.

Neither needs a credit card. Neither will ever charge you.

---

## Before you start

You need to be **13 or over** to make a GitHub account, and **13 or over**
for a Google account in most countries. If you're under that, ask a
parent to create the accounts and add you — that's completely normal
and takes nothing away from the project being yours.

---

## Part 1 — GitHub, to put the app online

GitHub Pages hosts websites for free. It gives you an address like
`https://yourname.github.io/sound-advice/` that anyone can open.

### 1. Make an account

Go to **github.com** and sign up. Pick a username you don't mind people
seeing — it becomes part of your app's web address.

### 2. Make a repository

- Click the **+** in the top right → **New repository**
- Repository name: `sound-advice`
- Set it to **Public** (Pages is free only for public repositories)
- Don't tick "Add a README" — the project already has files
- Click **Create repository**

### 3. Upload the app

The easiest route, no command line needed:

- On your new empty repository page, click **uploading an existing file**
- Drag in **everything** from the `sound-advice` folder — including the
  `js`, `icons` and `audio` folders
- Scroll down, click **Commit changes**

Check that `index.html` is at the *top level* of the repository, not
inside another folder. If you accidentally dragged the folder itself,
the app won't load.

### 4. Turn on Pages

- **Settings** (in the repository, not your account) → **Pages** in the
  left sidebar
- Under "Build and deployment", set Source to **Deploy from a branch**
- Branch: **main**, folder: **/ (root)** → **Save**

Wait two or three minutes, then reload that page. It will show your
address at the top:

```
https://YOURNAME.github.io/sound-advice/
```

Open it on your phone. The app should work immediately — you can sign
in, pick sounds, run the timer and take the test. Everything saves on
your own phone for now.

### 5. Add it to your home screen

- **iPhone:** open the link in Safari → Share button → *Add to Home Screen*
- **Android:** open in Chrome → menu (⋮) → *Install app* or *Add to Home screen*

It then opens fullscreen with its own icon, exactly like a normal app.
This is what you'll ask your friends to do.

---

## Part 2 — Firebase, so you can see everyone's data

Until you do this, each person's data stays on their own phone and you
can't collect anything. This is the step that turns it into a study.

### 1. Create the project

- Go to **console.firebase.google.com** and sign in with a Google account
- **Create a project** → name it `sound-advice`
- Turn Google Analytics **off** — you don't need it and it asks for
  extra agreements
- Click through to **Continue**

### 2. Register the web app

- On the project home page, click the **`</>`** (web) icon
- App nickname: `Sound Advice` → **Register app**
- Firebase now shows you a block of code. The part you need looks like:

```js
const firebaseConfig = {
  apiKey: "AIzaSyB…",
  authDomain: "sound-advice-1234.firebaseapp.com",
  projectId: "sound-advice-1234",
  storageBucket: "sound-advice-1234.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

**Copy those six lines.** Then in your repository, open
`firebase-config.js`, click the pencil icon to edit, and replace the
placeholder values with yours. Commit the change.

> These values are not secrets. Every Firebase web app has them visible
> in its page source. What actually protects your data is the security
> rules in step 5. If a judge asks about this, that's the answer.

### 3. Turn on anonymous sign-in

- Left sidebar → **Build** → **Authentication** → **Get started**
- **Sign-in method** tab → **Anonymous** → toggle **Enable** → **Save**

This lets the app prove it's the real app without anyone making a real
account. Your friends still just use a nickname and PIN.

### 4. Create the database

- Left sidebar → **Build** → **Firestore Database** → **Create database**
- Choose **Start in production mode**
- Location: pick one near you (`australia-southeast1` is closest to
  New Zealand) → **Enable**

### 5. Set the security rules

This is the important bit. Go to the **Rules** tab and replace
everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Only the app (signed in anonymously) can read or write,
    // and nothing can ever be edited after it is written.
    match /users/{userId} {
      allow read, create, update: if request.auth != null;
      allow delete: if request.auth != null;
    }

    match /sessions/{id} {
      allow read, create: if request.auth != null;
      allow update: if false;
      allow delete: if request.auth != null;
    }

    match /tests/{id} {
      allow read, create: if request.auth != null;
      allow update: if false;
      allow delete: if request.auth != null;
    }
  }
}
```

Click **Publish**.

`allow update: if false` means a session or test score can be written
once and never altered afterwards — including by you. Worth mentioning
on your board: it's a real data-integrity safeguard, not decoration.

### 6. Set your admin code

In `firebase-config.js`, change the last line:

```js
window.SA_ADMIN_CODE = "something-only-you-know";
```

That's the code for your results dashboard at
`https://YOURNAME.github.io/sound-advice/admin.html`.

This is a light lock, not real security — it keeps a curious friend
out, not a determined one. Since the data has no names in it, that's a
reasonable trade. Don't put the admin link in the message you send out.

### 7. Check it worked

Open the app, run a short study session, then open `admin.html` and
enter your code. The top line should say **"Live from Firebase"**
rather than "Firebase is not set up yet". If it does, you're collecting
data.

---

## Part 3 — Adding the two music tracks

The app works without these, but you lose the classical and lyrical
conditions, which are the two your 2025 study was actually about.

Read `audio/CREDITS.txt` — it lists where to find legally usable tracks
and what details you need to record. In short:

- **Classical** from **musopen.org**, filtered to public-domain
  *recordings* (an old piece played by a modern orchestra is still
  copyrighted — it's the recording that matters)
- **Lyrical** from **freemusicarchive.org**, filtered to CC BY

Convert both to MP3, name them `classical.mp3` and `lyrical.mp3`, and
upload them into the `audio` folder. Keep each under about 5 MB so
they load quickly on mobile data. They'll appear in the app
automatically — no code change needed.

---

## When you change something later

GitHub Pages takes one to three minutes to update after you commit.

If your phone still shows the old version after that, it's the offline
cache. Bump the version number at the top of `sw.js`:

```js
const CACHE = 'sound-advice-v2';   // was v1
```

Commit that, and every phone picks up the new version next time it
opens the app. **Do this every time you change any file**, or your
friends will keep using the old one without realising.

---

## If something breaks

**App shows a blank page.** `index.html` probably isn't at the top level
of the repository. Check the file list on your repository home page.

**Sounds don't play on an iPhone.** Check the silent switch on the side
of the phone. Web audio is muted by it, and there's no way for the app
to detect that.

**"Firebase is not set up yet"** in the dashboard. Either the config
still has `PASTE_` values in it, or anonymous sign-in wasn't enabled.

**Nothing appears in the dashboard but the app works.** Check the rules
were published, and that Anonymous sign-in is enabled in Authentication.

**A friend can't sign in with their nickname.** Nicknames are unique
across everyone. If someone already took it, they need a different one —
that's the "nickname is taken, or the PIN is wrong" message.
