// Test de bout en bout : deux joueurs (alice et bob) utilisent l'appli en même temps.
// Prérequis : copie locale de Supabase lancée et remise à zéro, joueurs créés, appli lancée.
// Le plus simple : `npm run check` (voir scripts/check.sh), qui fait tout.
import { createServer } from "node:http";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const MAIL = process.env.MAIL_URL ?? "http://127.0.0.1:54324";
const VENUE = "Gymnase " + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// Faux Green API : reçoit les messages destinés au groupe WhatsApp (GREEN_API_URL dans check.sh).
const whatsapp = [];
const greenApi = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "POST" && /\/waInstance\w+\/sendMessage\/\w+$/.test(req.url)) whatsapp.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ idMessage: String(whatsapp.length) }));
  });
});
await new Promise((r) => greenApi.listen(Number(process.env.GREEN_API_PORT ?? 54399), "127.0.0.1", r));

// Attend le message WhatsApp qui contient tous les morceaux de texte donnés, et le renvoie.
async function waitWhatsApp(...parts) {
  for (let i = 0; i < 40; i++) {
    const found = whatsapp.find((m) => m.chatId === "groupe@g.us" && parts.every((p) => m.message.includes(p)));
    if (found) {
      if (found.linkPreview !== false) throw new Error("L'aperçu du lien doit être désactivé");
      return found.message;
    }
    await sleep(250);
  }
  throw new Error(`Aucun message WhatsApp avec « ${parts.join(" », « ")} ». Reçus :\n${whatsapp.map((m) => m.message).join("\n---\n")}`);
}

async function loginMail(email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=to:${email}`)).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
      return {
        link: msg.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&"),
        code: msg.Text.match(/\b\d{6,10}\b/)[0],
      };
    }
    await sleep(500);
  }
  throw new Error(`Aucun e-mail reçu pour ${email}`);
}

// Connexion par le lien de l'e-mail, ou en saisissant le code à 6 chiffres dans l'appli.
async function login(browser, email, { withCode = false } = {}) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} : ${e.message}`));
  await page.goto(APP + "/");
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await page.fill("#email", email);
  await page.click("text=Recevoir un lien de connexion");
  await page.waitForSelector("text=E-mail envoyé");
  const mail = await loginMail(email);
  if (withCode) {
    await page.fill("#code", "00000000");
    await page.click("button:text-is('Se connecter')");
    await page.waitForSelector("text=Code incorrect");
    await page.fill("#code", mail.code);
    await page.click("button:text-is('Se connecter')");
  } else {
    await page.goto(mail.link);
  }
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
  const bob = await login(browser, "bob@test.fr", { withCode: true });
  ok("alice se connecte par le lien de l'e-mail, bob avec le code reçu (8 chiffres comme en ligne) (un mauvais code est refusé)");

  // Session du soir avec deux terrains
  const DATE = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  const stat = (page, label, value) => page.locator("div", { has: page.locator(`dt:text-is("${label}")`) }).locator(`dd:text-is("${value}")`);
  async function newBooking(page, { courts, start, end, price, play = true, payer }) {
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
    if (payer) await page.locator('select[name="booked_by"]').selectOption({ label: payer });
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
  if (await alice.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error("La page Nouvelle réservation déborde sur la largeur d'un téléphone");
  ok("nouvelle réservation : 20:00 – 22:00 au Prisme par défaut, total affiché sur le bouton");
  const evening = await newBooking(alice, { courts: [6, 9], price: "12,50" });
  await alice.waitForSelector(`text=20:00 – 22:00 · ${VENUE}`);
  await stat(alice, "Terrains", "6 · 9").waitFor();
  await stat(alice, "Joueurs", "1 / 8").waitFor();
  ok("alice réserve les terrains 6 et 9 (20:00 – 22:00 par défaut) et s'inscrit : 1/8 joueurs");
  const first = await waitWhatsApp("🏸 alice a réservé les terrains 6 et 9\n", VENUE, "Terrains : 6 · 9", "Places restantes : 7\n", evening);
  if (whatsapp.length !== 1) throw new Error(`Un seul message attendu pour deux terrains, reçu ${whatsapp.length}`);
  if (!first.includes(", 20:00 – 22:00 · ")) throw new Error(`Créneau absent du message : ${first}`);
  ok("le groupe WhatsApp reçoit un seul message : terrains 6 et 9, créneau, gymnase, 7 places restantes et le lien");

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
  const joined = await waitWhatsApp("🙋 bob s'inscrit\n", ", 20:00 – 22:00 · " + VENUE + "\nPlaces restantes : 6\n", evening);
  if (joined.includes("Terrains")) throw new Error(`Le message d'inscription ne doit pas lister les terrains : ${joined}`);
  ok("le groupe WhatsApp est prévenu de l'inscription de bob, avec les places restantes et sans la liste des terrains");

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
  // OK enregistre le lieu et la note sans passer par « Enregistrer », puis revient à la session
  await bob.fill('input[name="notes"]', "Volants fournis");
  await bob.getByRole("button", { name: "OK", exact: true }).click();
  await stat(bob, "Par joueur", "17,50 €").waitFor();
  await stat(bob, "Joueurs", "2 / 12").waitFor();
  await bob.waitForSelector("text=Volants fournis");
  ok("terrain 10 payé par bob et alice : 17,50 € chacun, 12 places");
  await waitWhatsApp("🏸 bob et alice ont réservé le terrain 10\n", "Terrains : 6 · 9 · 10", "Places restantes : 10\n");
  ok("le groupe WhatsApp est prévenu du terrain 10, au nom de ses deux payeurs (bob et alice)");
  ok("le bouton OK de Gérer enregistre la note et revient à la session");

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
  await waitWhatsApp(
    "🏸 alice a réservé le terrain 7 (22:00 – 23:00)\n",
    ", 20:00 – 23:00 · ",
    "Terrains :\n• 6 : 20:00 – 22:00\n• 7 : 22:00 – 23:00\n• 9 : 20:00 – 22:00\n• 10 : 20:00 – 22:00\n",
  );
  ok("le message WhatsApp donne les horaires de chaque terrain quand ils ne sont pas tous les mêmes");

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
  const joinBox = await bob.getByRole("button", { name: "M'inscrire en liste d'attente" }).boundingBox();
  const guestsBox = await bob.locator('select[aria-label="Invités extérieurs"]').boundingBox();
  if (!(joinBox.x < guestsBox.x && joinBox.width > 2 * guestsBox.width))
    throw new Error("Le bouton d'inscription doit être à gauche et plus large que la liste des invités");
  await bob.selectOption('select[aria-label="Invités extérieurs"]', "1");
  await bob.click("text=M'inscrire en liste d'attente");
  await bob.waitForSelector("text=Vous êtes n°1 sur la liste d'attente");
  await alice.waitForSelector("text=+1 invité", { timeout: 10000 });
  ok("la session de midi est pleine (4/4) : bob s'inscrit avec un invité (+1), le groupe passe en liste d'attente");
  await waitWhatsApp("🙋 frank s'inscrit\n", ", 12:00 – 13:00 · ", "Places restantes : 0\n");
  await waitWhatsApp(
    "🙋 bob s'inscrit avec 1 invité (en liste d'attente)\n",
    ", 12:00 – 13:00 · ",
    "Places restantes : 0 (2 en liste d'attente)\n",
    midday,
  );
  ok("le groupe WhatsApp annonce les inscriptions faites depuis Gérer, et celle de bob avec son invité en liste d'attente");

  // Une place libre ne suffit pas à bob et son invité : ils attendent ensemble.
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await alice.click('button[aria-label="Retirer carol"]');
  await alice.waitForSelector("text=Joueurs · 3 / 4");
  await sleep(1500);
  await bob.waitForSelector("text=Vous êtes n°1 sur la liste d'attente");
  ok("carol se désiste : une seule place, bob et son invité restent en attente");

  await alice.click('button[aria-label="Retirer eve"]');
  await bob.locator("text=sur la liste d'attente").waitFor({ state: "detached", timeout: 10000 });
  await stat(bob, "Joueurs", "4 / 4").waitFor();
  await bob.getByRole("list", { name: "Joueurs inscrits" }).getByText("bob +1").waitFor();
  await bob.waitForSelector("text=Vous payez aussi la part de vos invités : 2 × 2,00 € = 4,00 €");
  let promoted = null;
  for (let i = 0; i < 20 && !promoted; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=to:bob@test.fr`)).json();
    promoted = list.messages?.find((m) => m.Subject.includes("Une place s'est libérée"));
    if (!promoted) await sleep(500);
  }
  if (!promoted) throw new Error("bob n'a pas reçu l'e-mail de place libérée");
  ok("eve se désiste aussi : bob et son invité jouent (4/4), bob paie 2 parts et reçoit un e-mail");

  await bob.selectOption('select[name="guests"]', "2");
  await bob.waitForSelector("text=La session est complète : impossible d'ajouter un invité.");
  if ((await bob.inputValue('select[name="guests"]')) !== "1") throw new Error("Le nombre d'invités refusé est resté affiché");
  await stat(bob, "Joueurs", "4 / 4").waitFor();
  ok("bob ne peut pas ajouter un 2e invité dans une session complète");

  // Comptes. Soir : 40 € pour alice et bob, 20 € chacun ; alice a avancé 35 €, bob 5 €.
  // Midi : 8 € pour dave, frank, bob et son invité, 2 € la place, avancés par alice.
  // → bob doit 15 + 2 × 2 = 19 € à alice ; dave et frank lui doivent 2 € chacun.
  await bob.goto(APP + "/");
  await bob.waitForSelector("text=Vous devez 19,00 € à alice");
  await bob.click('nav >> text=Comptes');
  await bob.waitForSelector("text=Rembourser 19,00 € à alice");
  ok("comptes : bob doit 19,00 € à alice (seuls les joueurs inscrits paient, bob paie la part de son invité)");
  await bob.click("text=C'est fait, j'ai payé 19,00 €");
  await bob.waitForSelector("text=en attente de confirmation");
  await alice.goto(APP + "/comptes");
  await alice.waitForSelector("text=dit vous avoir remboursé");
  await alice.click("text=Bien reçu");
  await alice.waitForSelector("text=On vous doit 4,00 €");
  await bob.waitForSelector("text=Vous êtes à jour", { timeout: 10000 });
  ok("bob signale son remboursement, alice le confirme, bob est à jour");

  await alice.click("text=Signaler un autre remboursement");
  await alice.selectOption('select[name="from_player"]', { label: "bob" });
  await alice.selectOption('select[name="to_player"]', { label: "Moi" });
  await alice.fill('input[name="amount"]', "2");
  await alice.click("text=Signaler le remboursement");
  await alice.waitForSelector("text=On vous doit 2,00 €");
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

  // Annulation d'un terrain puis suppression de la session : le groupe WhatsApp est prévenu.
  const later = await newBooking(alice, { courts: [11, 12], start: "17:00", end: "18:00", price: "6" });
  await waitWhatsApp("🏸 Alice a réservé les terrains 11 et 12\n", "Places restantes : 7\n");
  // 2 heures sur le terrain 11, 1 heure sur le 12 : chaque terrain avec ses horaires.
  if ((await newBooking(alice, { courts: [11], start: "18:00", end: "19:00", price: "6", payer: "bob" })) !== later)
    throw new Error("Le terrain 11 de 18:00 à 19:00 aurait dû rejoindre la session de 17:00");
  await waitWhatsApp(
    "🏸 bob a réservé le terrain 11 (18:00 – 19:00)\n",
    ", 17:00 – 19:00 · ",
    "Terrains :\n• 11 : 17:00 – 19:00\n• 12 : 17:00 – 18:00\n",
  );
  ok("2 h sur le terrain 11 et 1 h sur le 12 : le message WhatsApp donne les horaires de chaque terrain");
  ok("alice réserve le terrain 11 en indiquant bob comme payeur : le message WhatsApp est au nom de bob");
  await alice.click('a:text-is("Gérer")');
  alice.once("dialog", (d) => d.accept());
  await alice.click('button[aria-label="Retirer le terrain 12 (17:00 – 18:00)"]');
  await alice.waitForSelector("text=Joueurs · 1 / 4");
  await waitWhatsApp("❌ Alice a annulé le terrain 12 (17:00 – 18:00)\n", "Terrains : 11\n", "Places restantes : 3\n", later);
  ok("alice retire le terrain 12 : le groupe WhatsApp reçoit l'annulation et les places restantes");
  alice.once("dialog", (d) => d.accept());
  await alice.getByRole("button", { name: "Supprimer la session" }).click();
  await alice.waitForURL(APP + "/");
  await waitWhatsApp("❌ Alice a supprimé la session\n", ", 17:00 – 19:00 · " + VENUE, "Terrains : 11");
  ok("alice supprime la session : le groupe WhatsApp est prévenu");

  if (errors.length) throw new Error("Erreurs dans le navigateur :\n" + errors.join("\n"));
  console.log("\nTous les tests sont passés.");
} finally {
  await browser.close();
  greenApi.close();
}
