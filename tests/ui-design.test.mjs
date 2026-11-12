// Tests de régression de la refonte d'interface (design system, contrastes, accessibilité).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import colors from "../constants/colors.ts";
import { GIT_I18N } from "../constants/i18nGit.ts";
import { MIN_FONT_SIZE, readableSize, touch, typography } from "../constants/theme.ts";

const C = colors.dark;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}
const UI_FILES = [...walk("app"), ...walk("components")];
const read = (p) => fs.readFileSync(p, "utf8");

function luminance(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ─── Design system ────────────────────────────────────────────────────────────

test("échelle typographique : aucun rôle sous le plancher de lisibilité", () => {
  for (const [name, style] of Object.entries(typography)) {
    assert.ok(style.fontSize >= MIN_FONT_SIZE, `${name} : ${style.fontSize}`);
  }
  assert.equal(readableSize(8), MIN_FONT_SIZE);
  assert.equal(readableSize(14), 14);
  assert.ok(touch.min >= 44);
});

test("aucune taille de texte inférieure à 11 dans les écrans et composants", () => {
  const bad = [];
  for (const f of UI_FILES) {
    for (const m of read(f).matchAll(/fontSize:\s*([0-9.]+)/g)) if (Number(m[1]) < MIN_FONT_SIZE) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

// ─── Contrastes (WCAG AA : 4,5:1 pour le texte) ───────────────────────────────

test("contrastes du texte sur les boutons pleins", () => {
  assert.ok(contrast(C.primaryForeground, C.primary) >= 4.5, "texte sur vert principal");
  assert.ok(contrast("#ffffff", C.destructiveSolid) >= 4.5, "texte sur rouge plein");
  assert.ok(contrast(C.aiForeground, C.ai) >= 4.5, "icône sur violet IA");
  assert.ok(contrast(C.foreground, C.cardSolid) >= 7);
  assert.ok(contrast(C.mutedForeground, C.cardSolid) >= 4.5);
});

test("plus de texte blanc sur le vert principal (1,96:1 avant la refonte)", () => {
  const login = read("app/login.tsx");
  assert.match(login, /loginBtnText: \{[^}]*color: colors\.primaryForeground/s);
  const files = read("app/(tabs)/files.tsx");
  assert.match(files, /pushBtnText: \{[^}]*color: colors\.primaryForeground/);
  assert.doesNotMatch(read("app/repo/[id]/index.tsx"), /syncText: \{ color: "#000"/);
});

// ─── Accessibilité ────────────────────────────────────────────────────────────

test("chaque bouton icône a un libellé lisible par le lecteur d'écran", () => {
  const missing = [];
  for (const f of UI_FILES) {
    for (const m of read(f).matchAll(/<IconBtn\b[^>]*?\/>/gs)) if (!/\blabel=/.test(m[0])) missing.push(`${f}: ${m[0].slice(0, 60)}`);
  }
  assert.deepEqual(missing, []);
  assert.match(read("components/GitUi.tsx"), /label: string;\s*\}\) \{\s*const colors = useColors\(\);\s*return \(\s*<PressableScale\s*hitSlop=\{8\}/);
});

test("les clés a11y.* utilisées existent en français et en anglais", () => {
  const used = new Set();
  for (const f of UI_FILES) for (const m of read(f).matchAll(/"(a11y\.[A-Za-z]+)"/g)) used.add(m[1]);
  assert.ok(used.size >= 20);
  for (const k of used) {
    assert.ok(GIT_I18N.fr[k], `fr manquant : ${k}`);
    assert.ok(GIT_I18N.en[k], `en manquant : ${k}`);
  }
});

test("plus aucun libellé tout en capitales ni textTransform uppercase", () => {
  for (const lang of ["fr", "en"]) {
    const caps = Object.entries(GIT_I18N[lang]).filter(([, v]) => {
      const letters = v.replace(/\{[^}]*\}/g, "").match(/\p{L}/gu) ?? [];
      return letters.length > 3 && letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
    });
    assert.deepEqual(caps.map(([k]) => k).filter((k) => !["g.common.ok"].includes(k)), [], lang);
  }
  for (const f of UI_FILES) assert.doesNotMatch(read(f), /textTransform: "uppercase"/, f);
});

test("la feuille d'actions remplace les menus natifs limités à 3 boutons", () => {
  for (const f of ["app/repo/[id]/branches.tsx", "app/repo/[id]/remotes.tsx", "app/repo/[id]/files.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /Alert\.alert/, f);
    assert.match(src, /showActionSheet\(/, f);
  }
  assert.doesNotMatch(read("app/repo/[id]/branches.tsx"), /g\.common\.more/);
  assert.match(read("app/_layout.tsx"), /<ActionSheetHost \/>/);
});

test("préférence « Réduire les animations » suivie en direct et respectée par la progression", () => {
  assert.match(read("components/GitUi.tsx"), /addEventListener\?\.\("reduceMotionChanged"/);
  const matrix = read("components/MatrixPushProgress.tsx");
  assert.match(matrix, /isReduceMotion\(\)/);
  assert.doesNotMatch(matrix, /SECURE CHANNEL|TRANSMITTING|MATRIX \/ PUSH/);
  // Le pourcentage reste calculé uniquement à partir de loaded / total.
  assert.match(matrix, /const determinate = total > 0;/);
});

test("régression : l'écran graphe importe bien les couleurs C (plantage au rendu avant)", () => {
  const src = read("app/repo/[id]/graph.tsx");
  if (/\bC\.[a-z]/.test(src)) assert.match(src, /import \{ C \} from "@\/constants\/colors";/);
});

test("régression : PickerModal a accès à la traduction pour son bouton Fermer", () => {
  const src = read("components/PickerModal.tsx");
  assert.match(src, /const \{ t \} = useI18n\(\);/);
});

function saturation(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

test("boutons vert et rouge vifs, sans perdre la lisibilité", () => {
  assert.ok(saturation(C.primary) >= 0.95, `vert ${C.primary}`);
  assert.ok(saturation(C.destructiveSolid) >= 0.9, `rouge ${C.destructiveSolid}`);
  assert.ok(contrast(C.primaryForeground, C.primary) >= 7);
  assert.ok(contrast(C.destructiveForeground, C.destructiveSolid) >= 4.5);
  const ui = read("components/GitUi.tsx");
  assert.match(ui, /variant === "danger" \? colors\.destructiveSolid/);
  assert.match(ui, /variant === "danger" \? colors\.destructiveForeground/);
});
