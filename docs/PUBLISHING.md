🇬🇧 English · 🇫🇷 [Français](PUBLIER.md)

# Publish this repository publicly on GitHub

Step-by-step guide, doable **entirely from a phone**. Allow 15 to 20 minutes.

> ⚠️ **Making a repository public also makes its whole history PUBLIC**: every old commit, even one deleted since, stays readable. Do step 1 before anything else.

---

## 1. Make sure no secret is in the repository

**What to look for** (in the files *and* in the commit history): GitHub tokens (`ghp_…`, `github_pat_…`), API keys (`AIza…`, `sk-…`), passwords, `.env` files, Android keystores (`*.jks`, `*.keystore`, `release.keystore`), `.pem` / `.p12` / `.key` files.

In Git-Push: open the repository → **History** → browse the commits, or use the **AI Agent** in *Chat* mode: "Search the repository for hard-coded API keys, tokens or passwords." (⚠️ the AI then reads your files: only do it with a provider you trust).

- This repository was checked: **no hard-coded key or token** in the current code. The OAuth *Client ID* (`constants/oauth.ts`) is not secret.
- `.gitignore` already excludes `.env`, `*.jks`, `*.p12`, `*.key`, `*.pem`, `android/` and `ios/`.

**If you find a secret that was already committed**, treat it as compromised:
1. **Revoke it immediately** (GitHub → Settings → Developer settings → Tokens; the provider's console for API keys) and create a new one.
2. Remove it from the files, then ideally **start from a clean history**: create a new repository with the current files (＋ button in Git-Push) instead of making the old one public.

## 2. Choose and add a license

Without a license the code is visible but **nobody is allowed to reuse it**. Common choices:

| License | In short |
|---|---|
| **MIT** | Very permissive: anyone can do anything, keeping your name. |
| **Apache-2.0** | Like MIT, with an explicit patent grant. |
| **GPL-3.0** | Redistributed modifications must stay free and under GPL. |

Easiest way: on GitHub (browser) → **Add file → Create new file** → name it `LICENSE` → a **Choose a license template** button appears → pick one, enter your name and the year, **Commit**. Then update the *License* section of `README.md`.

## 3. Adapt personal information

- **`app.json`**: the Expo account fields (`owner`, `extra.eas.projectId`, `updates.url`) have already been removed, so the file points to no personal account. If you later use EAS Build or OTA updates, run `npx eas init` to add them back.
- **App identifier** (`com.gitpush.app`): keep it if it is your identifier; anyone who forks the project will have to pick their own to publish their own version.
- **Display name**: the app is called **Git-Push** everywhere (`name` in `app.json`, interface, `README.md`, APK name in `.github/workflows/build-apk.yml`). If you rename it again, change those four places together.
- **`README.md`**: add **screenshots** (in `docs/img/`) and, if you like, build badges.

## 4. Update the repository with your latest changes

In Git-Push: **Repos** tab → your repository → **Sync** (or *Commit* then *Push*). Check on github.com that `README.md`, `docs/` and `LICENSE` are there.

## 5. Switch the repository to public

1. github.com → your repository → **Settings** (in the browser, use "Desktop site" if needed).
2. At the bottom: **Danger Zone → Change repository visibility → Make public**.
3. Confirm by typing the repository name.

*(A repository created from Git-Push is private by default: turn off "Private repository" at creation to make it public from the start.)*

## 6. Set up the public repository

- **Description and topics**: ⚙️ icon next to "About" → short description, website, **Topics** (`expo`, `react-native`, `git`, `android`, `ai-agent`, `github-actions`).
- **Actions**: **Actions** tab → enable workflows if GitHub offers to. Build minutes are **free on a public repository**.
- **First APK**: **Actions → Publier une release → Run workflow** → enter `v1.0.0` → the APK, generated release notes and a SHA-256 file appear in **Releases**, ready for anyone to download. (Or tick `publish` in *Build APK Android* for a quick unnumbered test build.)
- **Build secrets** (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. **Never put them in the code**; secrets are not exposed to pull requests coming from forks.
- **Signing**: without a keystore the APK is signed with a debug key (installable, not publishable on the Play Store). For continuous updates, **always keep the same keystore** and back it up outside the repository.

## 7. Protect the repository

Settings →
- **Code security**: turn on **Secret scanning** and **Push protection** (free on public repositories): GitHub will block a push containing a known key.
- **Branches** → *Add branch protection rule* on `main`: require a pull request before merging if you accept contributions.
- **General → Features**: enable **Issues** (and **Discussions** if you want a community).
- Add a **`SECURITY.md`** file explaining how to report a vulnerability.

## 8. Announce it

- Pin a **Release** with release notes (what's new, APK, Android requirements).
- Share the repository link and the latest APK.
- For others to build their own version: they **fork**, then **Actions → Run workflow** (see [`BUILD_APK.en.md`](BUILD_APK.en.md)).

---

## Final checklist

- [ ] No secret in the files **or** in the history
- [ ] `LICENSE` added, README *License* section updated
- [ ] Screenshots in the README
- [ ] Repository synced, checked on github.com
- [ ] Visibility switched to **Public**
- [ ] Description, topics, Issues enabled
- [ ] Secret scanning + Push protection enabled
- [ ] First APK published in **Releases**
