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
  await page.waitForSelector("text=Prochaines sessions");
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

  // Session du soir avec deux terrains
  const DATE = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  async function newBooking(page, { courts, start, end, price, play = true }) {
    await page.goto(APP + "/");
    await page.click("text=+ Réservation");
    await page.fill('input[name="venue"]', VENUE);
    await page.fill('input[type="date"]', DATE);
    if (start) await page.fill('input[name="start"]', start);
    if (end) await page.fill('input[name="end"]', end);
    for (const c of courts) await page.click(`label:has(input[value="${c}"])`);
    await page.fill('input[name="price"]', price);
    if (!play) await page.uncheck('input[name="i_play"]');
    await page.click("text=Ajouter la réservation");
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
    return page.url();
  }

  await alice.click("text=+ Réservation");
  if ((await alice.inputValue('input[name="venue"]')) !== "Le Prisme, Bobigny") throw new Error("Gymnase par défaut incorrect");
  if ((await alice.inputValue('input[name="start"]')) !== "20:00") throw new Error("Heure par défaut incorrecte");
  const evening = await newBooking(alice, { courts: [6, 9], price: "12,50" });
  await alice.waitForSelector("h1:has-text('20:00 – 22:00')");
  await alice.waitForSelector("text=Terrain 9");
  await alice.waitForSelector("text=1/8 joueurs");
  ok("alice réserve les terrains 6 et 9 (20:00 – 22:00 par défaut) et s'inscrit : 1/8 joueurs");

  const bobCard = bob.locator("li", { hasText: VENUE }).filter({ hasText: "20:00 –" });
  await bobCard.waitFor({ timeout: 10000 });
  ok("bob voit la session apparaître en temps réel");
  await bobCard.getByRole("button", { name: "Je m'inscris" }).click();
  await bobCard.getByText("12,50 € par joueur").waitFor();
  await alice.waitForSelector("text=12,50 € chacun", { timeout: 10000 });
  ok("bob s'inscrit, alice voit la part passer à 12,50 € en temps réel");

  // Réservation à deux payeurs
  await bobCard.getByText("Détails").click();
  const addBooking = bob.locator('form:has-text("Ajouter une réservation")');
  await addBooking.locator('select[name="court"]').selectOption("10");
  await addBooking.locator('input[name="price"]').fill("10");
  await addBooking.locator('select[name="booked_by"]').selectOption({ label: "bob" });
  await addBooking.locator('select[name="co_payer"]').selectOption({ label: "bob" });
  await addBooking.locator("button").click();
  await bob.waitForSelector("text=deux payeurs différents");
  ok("le même payeur ne peut pas être choisi deux fois");
  await addBooking.locator('select[name="co_payer"]').selectOption({ label: "alice" });
  await addBooking.locator("button").click();
  await bob.waitForSelector("text=et alice (moitié chacun)");
  await bob.waitForSelector("text=17,50 € chacun");
  await bob.waitForSelector("text=2/12 joueurs");
  ok("terrain 10 payé par bob et alice : 17,50 € chacun, 12 places");

  // QR code
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await bob.locator('input[type="file"]').first().setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
  await bob.waitForSelector('img[alt="QR code du terrain 6"]');
  await alice.waitForSelector('img[alt="QR code du terrain 6"]', { timeout: 10000 });
  await bob.waitForSelector("text=Remplacer le QR code");
  ok("bob ajoute le QR code du terrain 6, alice le voit en temps réel");

  // Regroupement : un créneau qui suit rejoint la même session, celui de midi en crée une autre
  if ((await newBooking(alice, { courts: [7], start: "22:00", end: "23:00", price: "5" })) !== evening)
    throw new Error("La réservation de 22:00 aurait dû rejoindre la session du soir");
  await alice.waitForSelector("h1:has-text('20:00 – 23:00')");
  await alice.waitForSelector("text=20,00 € chacun");
  ok("le terrain 7 de 22:00 à 23:00 rejoint la session du soir (20:00 – 23:00)");

  const midday = await newBooking(alice, { courts: [8], start: "12:00", end: "13:00", price: "8", play: false });
  if (midday === evening) throw new Error("La réservation de midi aurait dû créer une autre session");
  await alice.waitForSelector("h1:has-text('12:00 – 13:00')");
  await alice.waitForSelector("text=0/4 joueurs");
  ok("le terrain 8 à midi crée une session à part, sans inscrire alice");

  // Liste d'attente
  for (const p of ["carol", "dave", "eve", "frank"]) {
    await alice.selectOption('select[name="player_id"]', { label: p });
    await alice.getByRole("button", { name: "Inscrire", exact: true }).click();
    await alice.waitForSelector(`li:has-text(". ${p}")`);
  }
  await alice.waitForSelector("text=4/4 joueurs");
  await bob.goto(midday);
  await bob.click("text=M'inscrire en liste d'attente");
  await bob.waitForSelector("text=Vous êtes n°1 sur la liste d'attente");
  ok("la session de midi est pleine (4/4) : bob passe en liste d'attente");

  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await alice.locator("li", { hasText: /\d+\. carol/ }).getByRole("button", { name: "Retirer" }).click();
  await bob.waitForSelector("button:has-text('Me désinscrire')", { timeout: 10000 });
  await bob.locator("text=sur la liste d'attente").waitFor({ state: "detached" });
  let promoted = null;
  for (let i = 0; i < 20 && !promoted; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=to:bob@test.fr`)).json();
    promoted = list.messages?.find((m) => m.Subject.includes("Une place s'est libérée"));
    if (!promoted) await sleep(500);
  }
  if (!promoted) throw new Error("bob n'a pas reçu l'e-mail de place libérée");
  ok("carol se désiste : bob passe joueur et reçoit un e-mail");

  // Comptes. Soir : 40 € pour alice et bob, 20 € chacun ; alice a avancé 35 €, bob 5 €.
  // Midi : 8 € pour dave, eve, frank et bob, 2 € chacun, avancés par alice.
  // → bob doit 15 + 2 = 17 € à alice ; dave, eve et frank lui doivent 2 € chacun.
  await bob.click("text=Comptes");
  await bob.waitForSelector("text=Vous devez 17,00 € à alice");
  ok("comptes : bob doit 17,00 € à alice (seuls les joueurs inscrits paient)");
  await bob.click("text=J'ai payé 17,00 €");
  await bob.waitForSelector("text=en attente de confirmation");
  await alice.click("text=Comptes");
  await alice.waitForSelector("text=dit vous avoir remboursé");
  await alice.click("text=Je confirme");
  await alice.waitForSelector("text=On vous doit 6,00 €");
  await bob.waitForSelector("text=Vous êtes à jour", { timeout: 10000 });
  ok("bob signale son remboursement, alice le confirme, bob est à jour");

  await alice.selectOption('select[name="from_player"]', { label: "bob" });
  await alice.selectOption('select[name="to_player"]', { label: "alice" });
  await alice.fill('input[name="amount"]', "2");
  await alice.click("text=Signaler le remboursement");
  await alice.waitForSelector("text=On vous doit 4,00 €");
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
