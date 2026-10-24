// Test de bout en bout : deux joueurs (alice et bob) utilisent l'appli en même temps.
// Prérequis : copie locale de Supabase lancée et remise à zéro, joueurs créés, appli lancée.
// Le plus simple : `npm run check` (voir scripts/check.sh), qui fait tout.
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const MAIL = process.env.MAIL_URL ?? "http://127.0.0.1:54324";
const VENUE = "Gymnase " + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function magicLink(email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=to:${email}`)).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
      return msg.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
    }
    await sleep(500);
  }
  throw new Error(`Aucun e-mail reçu pour ${email}`);
}

async function login(browser, email) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} : ${e.message}`));
  await page.goto(APP + "/");
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await page.fill("#email", email);
  await page.click("text=Recevoir un lien de connexion");
  await page.waitForSelector("text=Lien envoyé");
  await page.goto(await magicLink(email));
  await page.waitForSelector("text=Prochaines soirées");
  return page;
}

function ok(label) {
  console.log(`✓ ${label}`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  // Connexion
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(APP + "/login");
  await stranger.fill("#email", "inconnu@test.fr");
  await stranger.click("text=Recevoir un lien de connexion");
  await stranger.waitForSelector("text=invité");
  ok("un inconnu ne peut pas se connecter");

  const alice = await login(browser, "alice@test.fr");
  const bob = await login(browser, "bob@test.fr");
  ok("alice et bob se connectent par lien e-mail");

  // Soirée avec deux terrains
  await alice.click("text=+ Ajouter");
  await alice.fill('input[name="venue"]', VENUE);
  await alice.fill('input[type="date"]', new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10));
  await alice.click('label:has(input[value="6"])');
  await alice.click('label:has(input[value="9"])');
  await alice.fill('input[name="price"]', "12,50");
  await alice.click("text=Ajouter la soirée");
  const aliceCard = alice.locator("li", { hasText: VENUE });
  await aliceCard.getByText("19:00 – 21:00").waitFor();
  await aliceCard.getByText("Terrain 9").waitFor();
  ok("alice crée une soirée avec les terrains 6 et 9, à la bonne heure");

  const bobCard = bob.locator("li", { hasText: VENUE });
  await bobCard.waitFor({ timeout: 10000 });
  ok("bob voit la soirée apparaître en temps réel");
  await bobCard.getByText("Je joue").click();
  await bobCard.getByText("12,50 € par joueur").waitFor();
  await aliceCard.getByText("12,50 € par joueur").waitFor({ timeout: 10000 });
  ok("bob s'inscrit, alice voit la part passer à 12,50 € en temps réel");

  // Terrain avec deux payeurs
  await bobCard.getByText("Détails").click();
  const addCourt = bob.locator('form:has-text("Ajouter un terrain")');
  await addCourt.locator('select[name="court"]').selectOption("10");
  await addCourt.locator('input[name="price"]').fill("10");
  await addCourt.locator('select[name="booked_by"]').selectOption({ label: "bob" });
  await addCourt.locator('select[name="co_payer"]').selectOption({ label: "bob" });
  await addCourt.locator("button").click();
  await bob.waitForSelector("text=deux payeurs différents");
  ok("le même payeur ne peut pas être choisi deux fois");
  await addCourt.locator('select[name="co_payer"]').selectOption({ label: "alice" });
  await addCourt.locator("button").click();
  await bob.waitForSelector("text=et alice (moitié chacun)");
  await bob.waitForSelector("text=17,50 € chacun");
  ok("terrain 10 payé par bob et alice, 17,50 € chacun");

  // Comptes : alice a avancé 25 + 5 = 30 €, bob 5 € ; chacun doit 17,50 € → bob doit 12,50 € à alice
  await bob.click("text=Comptes");
  await bob.waitForSelector("text=Vous devez 12,50 € à alice");
  ok("comptes : bob doit 12,50 € à alice");
  await bob.click("text=J'ai payé 12,50 €");
  await bob.waitForSelector("text=en attente de confirmation");
  await alice.click("text=Comptes");
  await alice.waitForSelector("text=dit vous avoir remboursé");
  await alice.click("text=Je confirme");
  await alice.waitForSelector("text=Vous êtes à jour");
  await bob.waitForSelector("text=Vous êtes à jour", { timeout: 10000 });
  ok("bob signale son remboursement, alice le confirme, les deux sont à jour");

  await alice.selectOption('select[name="from_player"]', { label: "bob" });
  await alice.selectOption('select[name="to_player"]', { label: "alice" });
  await alice.fill('input[name="amount"]', "2");
  await alice.click("text=Signaler le remboursement");
  await alice.waitForSelector("text=Vous devez 2,00 €");
  await bob.waitForSelector("text=On vous doit 2,00 €", { timeout: 10000 });
  ok("un remboursement signalé par celui qui le reçoit est confirmé d'office");

  // Profil
  await alice.click("text=Mon nom");
  await alice.fill('input[name="display_name"]', "Alice");
  await alice.click("text=Enregistrer");
  await alice.waitForSelector("text=Bonjour Alice");
  ok("alice change son nom");

  if (errors.length) throw new Error("Erreurs dans le navigateur :\n" + errors.join("\n"));
  console.log("\nTous les tests sont passés.");
} finally {
  await browser.close();
}
