import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverHelpers = require("../server/serve.js");

test("l'origine publique ignore X-Forwarded-Host et n'accepte qu'un Host sûr", () => {
  const origin = serverHelpers.publicOrigin({
    headers: { host: "git.example.test:8443", "x-forwarded-host": 'evil.test"><script>', "x-forwarded-proto": "https" },
    socket: {},
  });
  assert.deepEqual(origin, { protocol: "https", host: "git.example.test:8443" });
  assert.equal(serverHelpers.publicOrigin({
    headers: { host: 'good.test"><script>alert(1)</script>', "x-forwarded-proto": "https" },
    socket: {},
  }), null);
  assert.equal(serverHelpers.publicOrigin({
    headers: { host: "good.test", "x-forwarded-proto": "javascript" },
    socket: {},
  }).protocol, "http");
  assert.deepEqual(serverHelpers.publicOrigin({
    headers: { host: "[::1]:8080", "x-forwarded-proto": "https" },
    socket: {},
  }), { protocol: "https", host: "[::1]:8080" });
});

test("les valeurs HTML dynamiques sont échappées", () => {
  assert.equal(serverHelpers.escapeHtml(`<img src=x onerror="x"> & 'ok'`),
    "&lt;img src=x onerror=&quot;x&quot;&gt; &amp; &#39;ok&#39;");
});

test("le serveur refuse le traversal encodé et les chemins hors racine", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitpush-static-"));
  try {
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "assets", "app.js"), "ok");
    assert.equal(serverHelpers.resolveStaticPath("/assets/app.js", root), path.join(root, "assets", "app.js"));
    assert.equal(serverHelpers.resolveStaticPath("/%2e%2e/secret.txt", root), null);
    assert.equal(serverHelpers.resolveStaticPath("/..%2fsecret.txt", root), null);
    assert.equal(serverHelpers.resolveStaticPath("/%00secret", root), null);
    assert.equal(serverHelpers.resolveStaticPath("/%5c..%5csecret", root), null);
    assert.equal(serverHelpers.isInsideRoot(path.join(root, "assets", "app.js"), root), true);
    assert.equal(serverHelpers.isInsideRoot(path.join(root, "..", "secret.txt"), root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ci/prepare refuse un catalog inconnu au lieu de télécharger latest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitpush-ci-"));
  try {
    fs.mkdirSync(path.join(root, "ci"));
    fs.copyFileSync(path.join(process.cwd(), "ci", "prepare.js"), path.join(root, "ci", "prepare.js"));
    const original = {
      name: "audit-test",
      version: "1.0.0",
      dependencies: { "unknown-package": "catalog:" },
    };
    const packagePath = path.join(root, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify(original, null, 2));
    const run = spawnSync(process.execPath, [path.join(root, "ci", "prepare.js")], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /sans version approuvée/);
    assert.deepEqual(JSON.parse(fs.readFileSync(packagePath, "utf8")), original);
    assert.equal(JSON.parse(fs.readFileSync(packagePath + ".ci.bak", "utf8")).dependencies["unknown-package"], "catalog:");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("la signature release échoue si les secrets du keystore sont incomplets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitpush-sign-"));
  try {
    const ci = path.join(root, "ci");
    const androidApp = path.join(root, "android", "app");
    fs.mkdirSync(ci, { recursive: true });
    fs.mkdirSync(androidApp, { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), "ci", "sign-android.js"), path.join(ci, "sign-android.js"));
    fs.writeFileSync(path.join(androidApp, "release.keystore"), "keystore");
    fs.writeFileSync(path.join(androidApp, "build.gradle"), "android { signingConfigs { debug {} } }");
    const run = spawnSync(process.execPath, [path.join(ci, "sign-android.js")], {
      encoding: "utf8",
      env: { ...process.env, ANDROID_STORE_PASSWORD: "", ANDROID_KEY_ALIAS: "", ANDROID_KEY_PASSWORD: "" },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Secrets de signature manquants/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("serveur HTTP : GET/HEAD seulement, headers durcis et symlink hors racine refusé", async () => {
  const root = path.join(process.cwd(), "static-build");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gitpush-outside-"));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "ok.txt"), "hello");
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  try {
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "assets", "leak.txt"));
    await new Promise((resolve, reject) => {
      serverHelpers.server.once("error", reject);
      serverHelpers.server.listen(0, "127.0.0.1", resolve);
    });
    const address = serverHelpers.server.address();
    const port = address.port;
    const request = (method, pathname, headers = {}) => new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port, method, path: pathname,
        headers: { Host: `127.0.0.1:${port}`, ...headers },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
      req.end();
    });

    const ok = await request("GET", "/assets/ok.txt");
    assert.equal(ok.status, 200);
    assert.equal(ok.body, "hello");
    assert.equal(ok.headers["x-content-type-options"], "nosniff");

    const head = await request("HEAD", "/assets/ok.txt");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(head.headers["content-length"], "5");

    const leak = await request("GET", "/assets/leak.txt");
    assert.equal(leak.status, 403);
    assert.equal(leak.body, "Forbidden");

    const method = await request("POST", "/assets/ok.txt");
    assert.equal(method.status, 405);

    const landing = await request("GET", "/", {
      "X-Forwarded-Host": 'attacker.test"><script>alert(1)</script>',
      "X-Forwarded-Proto": "https",
    });
    assert.equal(landing.status, 200);
    assert.equal(landing.body.includes("attacker.test"), false);
  } finally {
    if (serverHelpers.server.listening) {
      await new Promise((resolve) => serverHelpers.server.close(resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
