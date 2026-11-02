🇬🇧 English · 🇫🇷 [Français](BUILD_APK.md)

# Build the APK on GitHub (no Expo account)

The `.github/workflows/build-apk.yml` workflow builds the app directly on GitHub: `expo prebuild`, then Gradle. It uses no EAS, no `EXPO_TOKEN` and no Expo account (the `owner`, `updates` and `extra.eas` fields of `app.json` are removed during the build, without touching your repository).

## Start a build (from your phone)

1. In your GitHub repository: **Actions** tab → **Build APK Android** → **Run workflow**.
2. Choose the options (the defaults are fine):
   - **build_type**: `release` (normal APK) or `debug`.
   - **abi**: `arm64-v8a` (recent phones, faster and lighter) or `all` (every processor, including emulators).
   - **minify**: shrinks and obfuscates the native code (R8) for a lighter APK. On by default; if R8 makes the build fail, it is automatically restarted without minification.
   - **publish**: publishes the APK in Releases (numbered test build; for a real version use "Publier une release").
3. Wait 10 to 25 minutes (the first build is the longest, the cache helps afterwards).
4. Download the APK from the **Releases** tab (direct link) or from the run's **Artifacts**.

A `push` to `main` or `master` also starts a build (without publishing a Release).

## Publish a release (official version)

The `.github/workflows/release.yml` workflow builds the APK **and publishes it in the Releases tab**, with automatically generated release notes and a `SHA256SUMS.txt` file to verify the download.

Two ways to start it, from your phone:

1. **Actions** → **Publier une release** → **Run workflow** → enter the version (`v1.0.0`, or `v1.0.0-beta.1` for a pre-release).
2. **Releases** → **Draft a new release** → create the tag `v1.0.0` → **Publish**. (Pushing a `v*` tag with `git` does the same.)

The version must look like `v1.2.3`: otherwise the workflow stops immediately with a clear message. A version with a hyphen (`-beta.1`) is automatically marked as a pre-release. The build is the one from `build-apk.yml` (reused), with your signing secrets if they are set.

## Secrets and variables (optional)

Repository → Settings → Secrets and variables → Actions.

| Name | Type | Purpose |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | secret | Your release keystore, base64-encoded. |
| `ANDROID_STORE_PASSWORD` | secret | Keystore password. |
| `ANDROID_KEY_ALIAS` | secret | Key alias. |
| `ANDROID_KEY_PASSWORD` | secret | Key password. |

## Signing

- **Without a keystore**: the release APK is signed with the Expo template's debug key. It installs normally; that is enough for personal use. It cannot be published on the Play Store.
- **With a keystore**: fill in the 4 `ANDROID_*` secrets. `ci/sign-android.js` then wires the real signature into the release build.

## Automatic retries

The build uses **no AI**. It restarts by itself in two cases only: a failure caused by R8 minification (restart without minification) and a short network outage (one more attempt). Any other error stops the build right away, with the list of errors in the **Summary** page.

## If it fails

Open the run → **Summary** page: a "The build failed" block lists the Gradle / Kotlin errors to copy. The full logs are in the `build-logs-N` artifact. You can also let the app fix it: in **Git-Push → AI Agent**, tap the 🔧 button (build auto-fix).

## Cost

Public repository: free minutes. Private repository: you use your GitHub plan's monthly quota (an Android build takes 10 to 25 minutes).
