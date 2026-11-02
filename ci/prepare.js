/**
 * prepare.js — Prépare le projet pour la compilation en CI
 *
 * Ce script est exécuté AVANT npm install pour :
 *   1. Supprimer les dépendances @workspace/* (spécifiques au monorepo Replit)
 *   2. Remplacer les références workspace: et catalog: par des versions réelles
 *   3. S'assurer que le package.json est compatible avec un environnement CI standard
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');
const PKG_PATH     = path.join(ROOT, 'package.json');
const BACKUP_PATH  = path.join(ROOT, 'package.json.ci.bak');

// ── Versions de remplacement pour le protocole catalog: ──────────────────────
// Ces versions correspondent aux entrées du pnpm-workspace.yaml du monorepo
const CATALOG_VERSIONS = {
  '@tanstack/react-query':  '^5.90.21',
  'react':                  '19.1.0',
  'react-dom':              '19.1.0',
  'zod':                    '^3.25.76',
  // Fallback générique si un package catalog: inconnu est rencontré
};

// ── Lecture du package.json ───────────────────────────────────────────────────
if (!fs.existsSync(PKG_PATH)) {
  console.error('❌ package.json introuvable à la racine du projet.');
  process.exit(1);
}

const raw = fs.readFileSync(PKG_PATH, 'utf8');
const pkg = JSON.parse(raw);

// Sauvegarde avant modification
fs.writeFileSync(BACKUP_PATH, raw, 'utf8');
console.log(`📦 Sauvegarde du package.json original → ${BACKUP_PATH}`);

// ── Nettoyage des dépendances incompatibles CI ────────────────────────────────
const removed   = [];
const replaced  = [];
const catalogUnknown = [];

function cleanDeps(depObj, label) {
  if (!depObj) return depObj;
  const cleaned = {};
  for (const [name, version] of Object.entries(depObj)) {
    // Supprimer les @workspace/* et workspace:* — non disponibles en CI standalone
    if (name.startsWith('@workspace/') || String(version).startsWith('workspace:')) {
      removed.push(`${label}: ${name}@${version}`);
      continue;
    }
    // Remplacer les catalog: par la vraie version
    if (String(version) === 'catalog:' || String(version).startsWith('catalog:')) {
      const real = CATALOG_VERSIONS[name];
      if (real) {
        cleaned[name] = real;
        replaced.push(`${label}: ${name} catalog: → ${real}`);
      } else {
        // Fallback : tenter de laisser npm résoudre avec "latest"
        cleaned[name] = 'latest';
        catalogUnknown.push(`${label}: ${name} (catalog: inconnu → latest)`);
      }
      continue;
    }
    cleaned[name] = version;
  }
  return cleaned;
}

pkg.dependencies     = cleanDeps(pkg.dependencies,     'dep');
pkg.devDependencies  = cleanDeps(pkg.devDependencies,  'devDep');
pkg.peerDependencies = cleanDeps(pkg.peerDependencies, 'peerDep');

// Supprimer les champs spécifiques aux workspaces
delete pkg.workspaces;

// Normaliser le nom (évite les erreurs npm avec les scopes @workspace)
if (pkg.name && pkg.name.startsWith('@workspace/')) {
  pkg.name = pkg.name.replace('@workspace/', '');
}

// ── Écriture du package.json modifié ─────────────────────────────────────────
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// ── Rapport ───────────────────────────────────────────────────────────────────
if (removed.length > 0) {
  console.log(`\n🧹 Dépendances @workspace/* supprimées (${removed.length}) :`);
  removed.forEach(r => console.log(`   - ${r}`));
}
if (replaced.length > 0) {
  console.log(`\n🔄 Références catalog: remplacées (${replaced.length}) :`);
  replaced.forEach(r => console.log(`   - ${r}`));
}
if (catalogUnknown.length > 0) {
  console.warn(`\n⚠️  catalog: inconnus résolus en "latest" (${catalogUnknown.length}) :`);
  catalogUnknown.forEach(r => console.warn(`   - ${r}`));
}
if (removed.length === 0 && replaced.length === 0) {
  console.log('✅ Aucune dépendance incompatible CI détectée.');
}

console.log('\n✅ package.json prêt pour la CI.');
