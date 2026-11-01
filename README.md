🇬🇧 English · 🇫🇷 [Français](README.fr.md)

# Git-Push

**A full Git client in your pocket, with an AI agent that edits your code for you.**

Git-Push is an Android app (Expo / React Native) that clones your repositories straight onto your phone, lets you edit, sync and publish them — no computer needed. An AI agent (Gemini, GPT or Claude, using your own API key) can read the project, edit files, create new repositories, write GitHub Actions workflows and automatically fix a failing build.

> The whole Git engine runs **on the phone** (isomorphic-git). No middleman server: the app talks directly to GitHub, GitLab or Gitea, and to your AI provider.

---

## What you can do

### Manage your repositories
- **Clone** a repository (full, or *light*: latest state only, much faster and smaller) from GitHub, GitLab, Gitea / Forgejo or any HTTPS URL.
- **Commit and push**: status, staging, commit, push, pull, merge with conflict resolution, branches, remotes, history and readable diffs.
- **Edit** files inside the app.
- **Upload files or ZIPs** to GitHub, and delete repositories (Files tab).
- **Issues, pull requests and runs** (GitHub Actions / GitLab CI) — browse and create.

### Automatic sync
- When the app opens and/or closes, or **scheduled** (every 15 min to 24 h — Android picks the exact moment).
- **Automatic retry** when the network comes back after a failure.
- Android: **Quick Settings tile**, home-screen **widget**, and sync when you open or leave **other apps** (for example your notes app) through an accessibility service that is **off by default** and never reads the screen — see [`docs/ACCESSIBILITY_DECLARATION.md`](docs/ACCESSIBILITY_DECLARATION.md).

### The AI agent ("AI Agent" tab)
- Pick a repository and describe what you want: the agent explores the code, proposes changes and **shows every diff before applying it** ("Accept all" to go faster).
- **Creates a new repository** (local and/or on GitHub) and writes all the files of a project into it.
- **Creates ready-to-use GitHub Actions workflows** (Android Kotlin APK, Expo APK, Node CI) and checks their YAML before pushing.
- **Build auto-fix** (🔧 button): the app pushes your code, waits for GitHub Actions, sends the errors to the AI, applies the fix and tries again (3 attempts at most).
- **Undo** (↩) the changes of the last request.
- Designed for the **free Gemini quota**: few calls, automatic wait after a quota error, a light model for simple tasks, a daily call counter.
- Works with **Gemini, GPT (OpenAI) or Claude** — you bring your own API key.

### Maintenance (Profile tab → Maintenance)
Space used by each repository (and cleanup of leftovers from interrupted clones), one-tap checks (storage, secure vault, Git, network), a recent-errors log and a report you can share.

### Languages
Français, English, Español, 中文, Русский.

---

## Install the app

### Option A — Download the APK (easiest)
1. Open the **Releases** tab of this repository on your phone.
2. Download `Git-Push-release-N.apk` from the latest release.
3. Open it and allow installation from this source if Android asks.

### Option B — Build the APK yourself on GitHub (no computer)
1. **Fork** this repository (or use your own).
2. **Actions** tab → **Build APK Android** → **Run workflow**.
3. Wait 10 to 25 minutes, then get the APK from **Releases** or from the run's **Artifacts**.

Details and optional secrets (signing, AI build fixing): [`docs/BUILD_APK.en.md`](docs/BUILD_APK.en.md).

### Option C — Develop locally
Requirements: Node.js 22, JDK 17, Android SDK.

```bash
npm install
npx expo prebuild --platform android
npx expo run:android     # development build on a device or emulator
npm test                 # unit tests (Node 22.6+)
```

> **Expo Go is not enough**: the app uses a native module (`modules/gitcrush-native`), background tasks and the secure vault. Use a development build.

---

## First use

1. **GitHub sign-in**: paste a *Personal Access Token*, or use code sign-in (*Device Flow*).
   - Classic token: tick **`repo`** and **`workflow`** (required to push `.github/workflows` files). Add **`delete_repo`** only if you want to delete repositories from the app.
   - Code sign-in: create an *OAuth App* (GitHub → Settings → Developer settings → OAuth Apps) with **Enable Device Flow**, then paste its *Client ID* in the app (or in `constants/oauth.ts`). The Client ID is not secret.
2. **Clone a repository** (Repos tab → Clone) or **create one** (＋ button).
3. **Turn on AI** (Profile tab → AI settings): choose a provider and paste your key.
   - Free Gemini key: <https://aistudio.google.com/app/apikey>.
4. Open the **AI Agent** tab and ask for what you want.

---

## Privacy and security

- Your **GitHub tokens, AI API keys, passwords and account tokens** are kept in the phone's **secure vault** (Android Keystore), never in plain text. Older installs are migrated automatically.
- No telemetry and no Git-Push server: the app sends nothing to its author.
- **What goes to the AI provider**: the files the assistant reads and the diffs, only when you use AI. On a free quota, the provider may use this data to improve its products. **Do not use AI on repositories that contain secrets.**
- The accessibility service (sync when other apps open) is optional, off by default, and never reads screen content.

---

## Project structure

```
app/            screens (Expo Router): tabs, repositories, forge, maintenance…
components/     UI components (including AgentChat, the AI agent)
context/        GitHub, repositories, languages
utils/git/      local Git engine (clone, commit, push, merge, storage…)
utils/ai/       AI agent, providers (Gemini/OpenAI/Claude), workflows, auto-fix
modules/        Android native module (tile, widget, accessibility)
ci/             CI build with AI fixing (retryBuild.js, fixProject.js…)
.github/        "Build APK Android" workflow
tests/          unit tests (npm test)
docs/           guides (APK build, accessibility, publishing)
```

## Contributing

Issues and pull requests are welcome. Before proposing a change, `npm test` must pass. To report a bug, attach the **report** from Profile tab → Maintenance (it contains no key or token).

## License

To be set by the author — see [`docs/PUBLISHING.md`](docs/PUBLISHING.md), "License" step. Without a license, nobody else may reuse the code.
