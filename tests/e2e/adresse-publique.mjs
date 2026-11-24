// Liens des messages WhatsApp sans APP_URL, comme dans le conteneur du VPS : le serveur autonome
// (.next/standalone, voir Dockerfile) écoute sur HOSTNAME=0.0.0.0 et le site est derrière un proxy.
// Le lien du récap des comptes doit être l'adresse du site (en-tête Host), jamais https://0.0.0.0:3000.
// Lancé par scripts/check.sh, après le build et avec la copie locale de la base.
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";

const PORT = Number(process.env.STANDALONE_PORT ?? 3004);
const SITE = "resas.exemple.fr";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Faux Green API (même port que dans scripts/check.sh) : garde les messages du groupe.
const messages = [];
const greenApi = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "POST") messages.push(JSON.parse(body).message);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ idMessage: String(messages.length) }));
  });
});
await new Promise((r) => greenApi.listen(Number(process.env.GREEN_API_PORT ?? 54399), "127.0.0.1", r));

const env = { ...process.env, PORT: String(PORT), HOSTNAME: "0.0.0.0" };
delete env.APP_URL;
const server = spawn("node", ["server.js"], { cwd: ".next/standalone", env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

// Requête comme la reçoit le conteneur derrière Traefik : Host du site, X-Forwarded-Proto https.
// (fetch ne laisse pas choisir l'en-tête Host, d'où node:http.)
const get = (path) =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: PORT, path, headers: { Host: SITE, "X-Forwarded-Proto": "https", Authorization: `Bearer ${process.env.CRON_SECRET}` } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });

try {
  let response;
  for (let i = 0; i < 60; i++) {
    response = await get("/api/cron/recap-comptes").catch(() => null);
    if (response) break;
    await sleep(500);
  }
  if (response?.status !== 200) throw new Error(`Récap : 200 attendu, reçu ${response?.status} ${response?.body}\n${log}`);
  const recap = messages.find((m) => m.includes("RÉCAP DES COMPTES"));
  if (!recap) throw new Error(`Récap non reçu par le faux Green API. Reçus : ${messages.join("\n---\n")}`);
  if (!recap.includes(`https://${SITE}/comptes`) || recap.includes("0.0.0.0"))
    throw new Error(`Le lien du récap n'est pas l'adresse du site (https://${SITE}/comptes) :\n${recap}`);
  console.log(`✓ sans APP_URL, le lien du récap est l'adresse du site (https://${SITE}/comptes), pas celle du conteneur`);
} finally {
  server.kill();
  greenApi.close();
}
