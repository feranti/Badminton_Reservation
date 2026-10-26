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
  await page.waitForSelector('nav[aria-label="Navigation principale"]');
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
  const stat = (page, label, value) => page.locator("div", { has: page.locator(`dt:text-is("${label}")`) }).locator(`dd:text-is("${value}")`);
  async function newBooking(page, { courts, start, end, price, play = true }) {
    await page.goto(APP + "/");
    await page.click('a[aria-label="Nouvelle réservation"]');
    await page.click('button[aria-label="Autre date"]');
    await page.fill('input[type="date"]', DATE);
    await page.getByRole("button", { name: "Modifier" }).click();
    await page.fill('input[name="venue"]', VENUE);
    if (start) await page.fill('input[name="start"]', start);
    if (end) await page.fill('input[name="end"]', end);
    for (const c of courts) await page.click(`label:has(input[value="${c}"])`);
    await page.fill('input[name="price"]', price);
    if (!play) await page.uncheck('input[name="i_play"]');
    await page.getByRole("button", { name: /^Réserver/ }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
    return page.url();
  }

  await alice.click('a[aria-label="Nouvelle réservation"]');
  if ((await alice.inputValue('input[name="venue"]')) !== "Le Prisme, Bobigny") throw new Error("Gymnase par défaut incorrect");
  if ((await alice.inputValue('input[name="start"]')) !== "20:00") throw new Error("Heure par défaut incorrecte");
  await alice.waitForSelector("text=20:00 – 22:00 · Le Prisme, Bobigny");
  await alice.click('label:has(input[value="6"])');
  await alice.click('label:has(input[value="9"])');
  await alice.fill('input[name="price"]', "12,50");
  await alice.getByRole("button", { name: "Réserver 2 terrains · 25,00 €" }).waitFor();
  ok("nouvelle réservation : 20:00 – 22:00 au Prisme par défaut, total affiché sur le bouton");
  const evening = await newBooking(alice, { courts: [6, 9], price: "12,50" });
  await alice.waitForSelector(`text=20:00 – 22:00 · ${VENUE}`);
  await stat(alice, "Terrains", "6 · 9").waitFor();
  await stat(alice, "Joueurs", "1 / 8").waitFor();
  ok("alice réserve les terrains 6 et 9 (20:00 – 22:00 par défaut) et s'inscrit : 1/8 joueurs");

  const bobCard = bob.locator("a", { hasText: VENUE }).filter({ hasText: "20:00 –" });
  await bobCard.waitFor({ timeout: 10000 });
  ok("bob voit la session apparaître en temps réel");
  await bobCard.click();
  await bob.getByRole("button", { name: "Je m'inscris" }).click();
  await bob.getByRole("button", { name: "Me désinscrire" }).waitFor();
  await stat(bob, "Par joueur", "12,50 €").waitFor();
  await stat(alice, "Par joueur", "12,50 €").waitFor({ timeout: 10000 });
  await bob.goto(APP + "/");
  await bobCard.getByText("Inscrit").waitFor();
  ok("bob s'inscrit, alice voit la part passer à 12,50 € en temps réel, l'accueil l'affiche inscrit");

  // Désinscription : une confirmation est demandée ; si bob annule, il reste inscrit.
  await bobCard.click();
  let question = "";
  bob.once("dialog", (d) => ((question = d.message()), d.dismiss()));
  await bob.getByRole("button", { name: "Me désinscrire" }).click();
  if (!question.includes("Vous désinscrire")) throw new Error(`confirmation inattendue : « ${question} »`);
  await sleep(1000);
  await stat(bob, "Joueurs", "2 / 8").waitFor();
  bob.once("dialog", (d) => d.accept());
  await bob.getByRole("button", { name: "Me désinscrire" }).click();
  await bob.getByRole("button", { name: "Je m'inscris" }).waitFor();
  await stat(alice, "Par joueur", "25,00 €").waitFor({ timeout: 10000 });
  await bob.getByRole("button", { name: "Je m'inscris" }).click();
  await stat(alice, "Par joueur", "12,50 €").waitFor({ timeout: 10000 });
  await bob.goto(APP + "/");
  ok("bob se désinscrit après confirmation (alice repasse à 25,00 €), puis se réinscrit");

  // Réservation à deux payeurs, depuis l'écran Gérer
  await bobCard.click();
  await bob.click('a:text-is("Gérer")');
  await bob.click("text=+ Ajouter un terrain");
  const addBooking = bob.locator('form[aria-label="Ajouter un terrain"]');
  await addBooking.locator('select[name="court"]').selectOption("10");
  await addBooking.locator('input[name="price"]').fill("10");
  await addBooking.locator('select[name="booked_by"]').selectOption({ label: "Moi" });
  await addBooking.getByText("+ Partager le paiement").click();
  await addBooking.locator('select[name="co_payer"]').selectOption({ label: "Moi" });
  await addBooking.getByRole("button", { name: "Ajouter le terrain" }).click();
  await bob.waitForSelector("text=deux payeurs différents");
  ok("le même payeur ne peut pas être choisi deux fois");
  await addBooking.locator('select[name="co_payer"]').selectOption({ label: "alice" });
  await addBooking.getByRole("button", { name: "Ajouter le terrain" }).click();
  await bob.waitForSelector("text=et alice (moitié chacun)");
  await bob.waitForSelector("text=Joueurs · 2 / 12");
  await bob.click('a:text-is("OK")');
  await stat(bob, "Par joueur", "17,50 €").waitFor();
  await stat(bob, "Joueurs", "2 / 12").waitFor();
  ok("terrain 10 payé par bob et alice : 17,50 € chacun, 12 places");

  // QR code
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await bob.click('a:text-is("Gérer")');
  await bob.locator('input[type="file"]').first().setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
  await bob.waitForSelector("text=QR code ajouté");
  await bob.getByRole("button", { name: "Remplacer" }).waitFor();
  const qrLink = alice.locator("section", { hasText: "QR codes d'entrée" }).locator("a", { hasText: "Terrain 6" });
  await qrLink.waitFor({ timeout: 10000 });
  ok("bob ajoute le QR code du terrain 6, alice le voit en temps réel");

  // Regroupement : un créneau qui suit rejoint la même session, celui de midi en crée une autre
  if ((await newBooking(alice, { courts: [7], start: "22:00", end: "23:00", price: "5" })) !== evening)
    throw new Error("La réservation de 22:00 aurait dû rejoindre la session du soir");
  await alice.waitForSelector(`text=20:00 – 23:00 · ${VENUE}`);
  await stat(alice, "Par joueur", "20,00 €").waitFor();
  ok("le terrain 7 de 22:00 à 23:00 rejoint la session du soir (20:00 – 23:00)");

  const midday = await newBooking(alice, { courts: [8], start: "12:00", end: "13:00", price: "8", play: false });
  if (midday === evening) throw new Error("La réservation de midi aurait dû créer une autre session");
  await alice.waitForSelector(`text=12:00 – 13:00 · ${VENUE}`);
  await stat(alice, "Joueurs", "0 / 4").waitFor();
  ok("le terrain 8 à midi crée une session à part, sans inscrire alice");

  // Liste d'attente
  await alice.click('a:text-is("Gérer")');
  for (const p of ["carol", "dave", "eve", "frank"]) {
    await alice.selectOption('select[name="player_id"]', { label: p });
    await alice.getByRole("button", { name: "Inscrire", exact: true }).click();
    await alice.locator(`button[aria-label="Retirer ${p}"]`).waitFor();
  }
  await alice.waitForSelector("text=Joueurs · 4 / 4");
  await bob.goto(midday);
  await bob.click("text=M'inscrire en liste d'attente");
  await bob.waitForSelector("text=Vous êtes n°1 sur la liste d'attente");
  ok("la session de midi est pleine (4/4) : bob passe en liste d'attente");

  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await alice.click('button[aria-label="Retirer carol"]');
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
  await bob.goto(APP + "/");
  await bob.waitForSelector("text=Vous devez 17,00 € à alice");
  await bob.click('nav >> text=Comptes');
  await bob.waitForSelector("text=Rembourser 17,00 € à alice");
  ok("comptes : bob doit 17,00 € à alice (seuls les joueurs inscrits paient)");
  await bob.click("text=C'est fait, j'ai payé 17,00 €");
  await bob.waitForSelector("text=en attente de confirmation");
  await alice.goto(APP + "/comptes");
  await alice.waitForSelector("text=dit vous avoir remboursé");
  await alice.click("text=Bien reçu");
  await alice.waitForSelector("text=On vous doit 6,00 €");
  await bob.waitForSelector("text=Vous êtes à jour", { timeout: 10000 });
  ok("bob signale son remboursement, alice le confirme, bob est à jour");

  await alice.click("text=Signaler un autre remboursement");
  await alice.selectOption('select[name="from_player"]', { label: "bob" });
  await alice.selectOption('select[name="to_player"]', { label: "Moi" });
  await alice.fill('input[name="amount"]', "2");
  await alice.click("text=Signaler le remboursement");
  await alice.waitForSelector("text=On vous doit 4,00 €");
  await bob.waitForSelector("text=On vous doit 2,00 €", { timeout: 10000 });
  ok("un remboursement signalé par celui qui le reçoit est confirmé d'office");

  // Aide sur le calcul des comptes
  await alice.click("text=Comment c'est calculé ?");
  await alice.waitForSelector("h1:has-text('Comment sont calculés les comptes ?')");
  await alice.waitForSelector("text=Qui rembourse qui");
  ok("la page d'aide explique le calcul des comptes");

  // Profil
  await alice.goto(APP + "/");
  await alice.click('a[aria-label="Mon profil"]');
  await alice.fill('input[name="display_name"]', "Alice");
  await alice.getByRole("button", { name: "Enregistrer" }).click();
  await alice.waitForSelector("text=Bonjour Alice");
  ok("alice change son nom");

  // Thème : clair, sombre ou celui du téléphone
  const theme = () => alice.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const background = () => alice.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await alice.emulateMedia({ colorScheme: "dark" });
  if ((await background()) !== "rgb(43, 45, 48)") throw new Error("Le mode sombre du téléphone n'est pas suivi");
  await alice.getByRole("button", { name: "Clair" }).click();
  if ((await theme()) !== "light" || (await background()) !== "rgb(250, 250, 249)") throw new Error("Thème clair non appliqué");
  await alice.emulateMedia({ colorScheme: "light" });
  await alice.getByRole("button", { name: "Sombre" }).click();
  await alice.reload();
  await alice.waitForSelector("text=Bonjour Alice");
  if ((await theme()) !== "dark" || (await background()) !== "rgb(43, 45, 48)") throw new Error("Thème sombre non gardé");
  await alice.getByRole("button", { name: "Sombre", pressed: true }).waitFor();
  await alice.getByRole("button", { name: "Système" }).click();
  if ((await theme()) !== null || (await background()) !== "rgb(250, 250, 249)") throw new Error("Thème système non appliqué");
  ok("thème clair, sombre (gardé après rechargement) ou celui du téléphone");

  if (errors.length) throw new Error("Erreurs dans le navigateur :\n" + errors.join("\n"));
  console.log("\nTous les tests sont passés.");
} finally {
  await browser.close();
}
