#!/usr/bin/env node
/**
 * sign-android.js — Injecte une vraie config de signature "release" dans
 * le build.gradle généré par `expo prebuild`, à partir des variables
 * d'environnement (keystore décodé + mots de passe).
 *
 * Pourquoi ce script existe :
 * Par défaut, le build.gradle généré par `expo prebuild` signe TOUJOURS
 * le build "release" avec le keystore de debug (signingConfigs.debug),
 * même si un vrai keystore de production est fourni à côté. Sans ce
 * script, définir les secrets GitHub (ANDROID_KEYSTORE_BASE64 etc.) n'a
 * silencieusement aucun effet sur la signature de l'APK.
 *
 * Comportement :
 *  - Si aucun keystore n'est présent (android/app/release.keystore),
 *    ne fait rien : l'APK release reste signé en debug (utile pour les
 *    builds de test sans configurer de vrai keystore).
 *  - Si le keystore est présent mais que le build.gradle n'a pas la forme
 *    attendue (changement de version d'Expo, etc.), échoue BRUYAMMENT
 *    plutôt que de produire un APK mal signé sans prévenir.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ANDROID_APP_DIR = path.join(__dirname, '..', 'android', 'app');
const GRADLE_PATH = path.join(ANDROID_APP_DIR, 'build.gradle');
const KEYSTORE_PATH = path.join(ANDROID_APP_DIR, 'release.keystore');

if (!fs.existsSync(KEYSTORE_PATH)) {
  console.log('ℹ️  Pas de keystore release trouvé — l\'APK release restera signé avec le keystore de debug.');
  process.exit(0);
}

if (!fs.existsSync(GRADLE_PATH)) {
  console.error('❌ android/app/build.gradle introuvable — lance "expo prebuild" avant ce script.');
  process.exit(1);
}

let gradle = fs.readFileSync(GRADLE_PATH, 'utf8');

if (gradle.includes('signingConfigs.release')) {
  console.log('ℹ️  Config de signature release déjà présente — rien à faire.');
  process.exit(0);
}

// 1. Ajoute un bloc `release { ... }` dans `signingConfigs { ... }`,
//    lisant le mot de passe/alias depuis les variables d'environnement
//    (jamais en dur dans le fichier).
const releaseSigningBlock = `
        release {
            storeFile file('release.keystore')
            storePassword System.getenv("ANDROID_STORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`;

const signingConfigsMarker = /signingConfigs\s*\{/;
if (!signingConfigsMarker.test(gradle)) {
  console.error('❌ Bloc "signingConfigs {" introuvable dans build.gradle — format inattendu, abandon.');
  process.exit(1);
}
gradle = gradle.replace(signingConfigsMarker, (m) => `${m}${releaseSigningBlock}`);

// 2. Fait pointer buildTypes.release.signingConfig vers signingConfigs.release
//    (au lieu de signingConfigs.debug généré par défaut).
const releaseBuildTypeMarker = /(release\s*\{[^}]*?signingConfig\s+)signingConfigs\.debug/s;
if (!releaseBuildTypeMarker.test(gradle)) {
  console.error('❌ "signingConfig signingConfigs.debug" introuvable dans buildTypes.release — format inattendu, abandon.');
  process.exit(1);
}
gradle = gradle.replace(releaseBuildTypeMarker, '$1signingConfigs.release');

fs.writeFileSync(GRADLE_PATH, gradle, 'utf8');
console.log('✅ Config de signature release injectée dans android/app/build.gradle');
