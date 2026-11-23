// Ancien site avec NOUVEAU_SITE : chaque page annonce le déménagement et renvoie au même chemin.
// Usage : APP_URL=http://127.0.0.1:3003 NOUVEAU_SITE=https://nouveau.exemple.fr node tests/e2e/demenagement.mjs
import assert from "node:assert/strict";

const app = process.env.APP_URL;
const target = new URL(process.env.NOUVEAU_SITE).origin;

const page = await fetch(`${app}/sessions/abc?x=1&y=%22%3Cb%3E`, { redirect: "manual" });
assert.equal(page.status, 200);
assert.match(page.headers.get("content-type"), /^text\/html/);
assert.equal(page.headers.get("cache-control"), "no-store");
const html = await page.text();
assert.match(html, /Le site a déménagé/);
assert.ok(html.includes(`href="${target}/sessions/abc?x=1&amp;y=%22%3Cb%3E"`), "lien vers le même chemin");
assert.ok(html.includes(`content="5;url=${target}/sessions/abc?x=1&amp;y=%22%3Cb%3E"`), "redirection automatique");
assert.ok(!html.includes("<b>"), "rien n'est injecté dans la page");

// Un chemin qui ressemble à une autre adresse reste sur le nouveau site.
const sneaky = await (await fetch(`${app}//evil.example/x`, { redirect: "manual" })).text();
assert.ok(!/url=https?:\/\/evil/.test(sneaky) && !/href="https?:\/\/evil/.test(sneaky), "jamais un autre domaine");

// Sans session ni base : la page de connexion annonce aussi le déménagement.
assert.match(await (await fetch(`${app}/login`)).text(), /Le site a déménagé/);

// Tâches planifiées et envois de formulaires : erreur 410, pas de page.
const cron = await fetch(`${app}/api/cron/recap-comptes`, { headers: { Authorization: "Bearer x" } });
assert.equal(cron.status, 410);
const post = await fetch(`${app}/login`, { method: "POST", body: "a=1" });
assert.equal(post.status, 410);

console.log("✓ Déménagement : message, lien et redirection vers le même chemin, API fermées");
