# WebRelay

> Extract anything from any webpage — locally, silently, repeatably.

WebRelay is a Chrome MV3 extension that lets you build reusable extraction profiles for any site. Describe what you want to extract, let Codex generate a profile, then run it with a single keystroke — no cloud, no subscription, no repeated copy-paste.

**Local-first at runtime.** Once a profile is saved, Quick Run and `Alt+Shift+E` work entirely inside the extension. The optional backend is only needed when you want to create or revise profiles with Codex Studio.

---

## Features

- **Codex Studio** — describe your intent or leave it blank, and Codex generates a recipe + JS transform for you
- **Quick Run** — one-click execution for saved profiles, with Copy / Download / Copy+Download output modes
- **Keyboard shortcut** — `Alt+Shift+E` silently runs the last profile for the current site, no popup needed
- **Hostname scoping** — a profile saved on `example.com/products/1` works across all `example.com` pages
- **Revision workflow** — run the existing profile first, then refine with feedback; Codex sees the actual output

---

## Setup

```bash
npm install
npm test
npm run build
```

Load `extension/dist` as an unpacked extension in Chrome.

For manual testing, open `test-pages/chatbot.html` in Chrome and follow the sample config in `test-pages/chatbot-config.md`.

---

## Codex Studio (backend)

The backend powers profile generation. It requires a local Codex SDK/CLI login.

```bash
npm run dev:backend
```

The backend runs at `http://localhost:8787`. Once you've saved a profile, you can stop the backend — Quick Run and the keyboard shortcut keep working without it.

### Backend config

Create `backend/.env` (all fields optional):

```
PORT=8787
CODEX_MODEL=
CODEX_REASONING_EFFORT=
CODEX_WORKING_DIRECTORY=
```

---

## Usage

### Codex Studio

Click the extension icon on any HTTP/HTTPS page to open the popup, then switch to the **Codex Studio** tab.

1. Enter an extraction intent, or leave blank to let Codex suggest what's worth extracting.
2. Review the generated recipe and the live preview output.
3. Add feedback to refine — Codex sees the current output and adjusts accordingly.
4. Save the profile when it looks right.

### Quick Run

The **Quick Run** tab (default) lists all profiles saved for the current hostname.

Each profile can be:
- **Run** — executes the recipe + transform and applies the saved action
- **Edited** — opens the manual editor to tweak the recipe or transform directly
- **Deleted** — removes the profile
- **Action switched** — toggle between **Copy**, **Download**, and **Copy + Download** per profile; the choice persists and is reused by the keyboard shortcut

### Keyboard shortcut

`Alt+Shift+E` — silently runs the last successfully used profile for the current hostname. No popup, no clicks. If nothing has been run yet on this site, a toast appears instead.

Rebind at `chrome://extensions/shortcuts`.

---

## Development

```bash
npm test                                          # run all tests
npm test -w @extractor/shared                     # shared package only
npm test -w @extractor/backend                    # backend only
npx tsc -p extension/tsconfig.json --noEmit       # extension type check
```
