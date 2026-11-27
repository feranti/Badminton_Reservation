// Test de bout en bout : deux joueurs (alice et bob) utilisent l'appli en même temps.
// Prérequis : base neuve créée (scripts/creer-base.sh), joueurs créés, Mailpit et appli lancés.
// ADMIN_DB_URL : la base en postgres, pour préparer les données (le site n'écrit pas dans auth.users).
// Le plus simple : `npm run check` (voir scripts/check.sh), qui fait tout.
import { createServer } from "node:http";
import postgres from "postgres";
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

// Attend un e-mail pour cette adresse dont l'objet contient le texte donné.
async function waitMail(email, subject) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=to:${email}`)).json();
    if (list.messages?.some((m) => m.Subject.includes(subject))) return;
    await sleep(500);
  }
  throw new Error(`${email} n'a pas reçu l'e-mail « ${subject} »`);
}

async function loginMail(email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=to:${email}`)).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
      const link = msg.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
      if (!link.startsWith(`${APP}/auth/confirm?jeton=`)) throw new Error(`Lien de connexion hors du site : ${link}`);
      const code = msg.Text.match(/^Votre code de connexion : (\d{8})$/m)?.[1];
      // Pour que Gmail propose « Copier le code » : le code dans l'objet et en tête du corps,
      // et aucun autre nombre dans l'e-mail (hors lien).
      const withoutLink = (t) => t.replaceAll(link, "").replace(/href="[^"]*"/g, "").replace(/style="[^"]*"/g, "");
      const numbers = [msg.Subject, withoutLink(msg.Text), withoutLink(msg.HTML)].flatMap((t) => t.match(/\d+/g) ?? []);
      if (!code || msg.Subject !== `${code} est votre code de connexion à Badminton Résas` || numbers.some((n) => n !== code)) {
        throw new Error(`E-mail de connexion mal formé pour Gmail :\n${msg.Subject}\n${msg.Text}`);
      }
      return { link, code };
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

  // Icônes de l'appli (volant), accessibles sans être connecté
  await stranger.waitForSelector('link[rel="apple-touch-icon"]', { state: "attached" });
  await stranger.waitForSelector('link[rel="manifest"]', { state: "attached" });
  const manifest = await (await fetch(APP + "/manifest.webmanifest")).json();
  if (manifest.icons?.length !== 3) throw new Error("manifest sans icônes : " + JSON.stringify(manifest));
  for (const path of ["/favicon.ico", "/apple-icon.png", ...manifest.icons.map((i) => i.src)]) {
    const res = await fetch(APP + path, { redirect: "manual" });
    if (res.status !== 200 || !/^image\//.test(res.headers.get("content-type") ?? "")) throw new Error(`icône ${path} : ${res.status}`);
  }
  ok("l'icône du volant est servie (favicon, écran d'accueil iPhone et Android)");

  const alice = await login(browser, "alice@test.fr");
  const bob = await login(browser, "bob@test.fr", { withCode: true });
  ok("alice se connecte par le lien de l'e-mail, bob avec le code reçu (8 chiffres comme en ligne) (un mauvais code est refusé)");

  // Le lien ne sert qu'une fois, un seul e-mail par minute, et « Se déconnecter » ferme la session
  {
    const carol = await login(browser, "carol@test.fr");
    const { link } = await loginMail("carol@test.fr");
    const other = await (await browser.newContext()).newPage();
    await other.goto(link);
    await other.waitForSelector("text=Le lien a expiré");
    await other.fill("#email", "carol@test.fr");
    await other.click("text=Recevoir un lien de connexion");
    await other.waitForSelector("text=patientez une minute");
    const session = (await carol.context().cookies()).find((c) => c.name === "resas_session");
    if (!session?.httpOnly || session.sameSite !== "Lax") throw new Error("Le cookie de session doit être httpOnly et SameSite=Lax");
    await carol.goto(APP + "/profil");
    await carol.getByRole("button", { name: "Se déconnecter" }).click();
    await carol.waitForURL(/\/login$/);
    const thief = await browser.newContext();
    await thief.addCookies([{ ...session, expires: -1 }]);
    const stolen = await thief.newPage();
    await stolen.goto(APP + "/comptes");
    await stolen.waitForURL(/\/login$/);
    await Promise.all([carol.context().close(), other.context().close(), thief.close()]);
    ok("le lien de l'e-mail ne sert qu'une fois, un 2e e-mail attend une minute, et une session fermée ne rouvre plus rien");
    // L'adresse des liens et des redirections vient d'APP_URL, jamais des en-têtes de la requête.
    const spoofed = await fetch(`${APP}/auth/confirm?jeton=x`, {
      redirect: "manual",
      headers: { "X-Forwarded-Host": "piege.example", Origin: "https://piege.example" },
    });
    if (!spoofed.headers.get("location")?.startsWith(`${APP}/login`)) throw new Error(`Redirection détournée : ${spoofed.headers.get("location")}`);
    ok("un en-tête X-Forwarded-Host envoyé par le visiteur ne change ni les liens de l'e-mail ni les redirections");
  }

  // Un joueur banni (auth.users.banned_until) est déconnecté tout de suite.
  {
    const sql = postgres(process.env.ADMIN_DB_URL, { max: 1 });
    const dave = await login(browser, "dave@test.fr");
    await sql`update auth.users set banned_until = now() + interval '24 hours' where email = 'dave@test.fr'`;
    await dave.goto(APP + "/comptes");
    await dave.waitForURL(/\/login$/);
    await sql`update auth.users set banned_until = null where email = 'dave@test.fr'`;
    await Promise.all([dave.context().close(), sql.end()]);
    ok("un joueur banni est déconnecté tout de suite, même avec une session ouverte");
  }

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
  // Les comptes ne tiennent compte que des sessions terminées : pour les vérifier, le test décale
  // des sessions (et leurs terrains) dans le passé (days < 0), puis les ramène si besoin.
  async function shiftSessions(ids, days) {
    const sql = postgres(process.env.ADMIN_DB_URL, { max: 1 });
    const shift = `${days} days`;
    await sql`update public.sessions set starts_at = starts_at + ${shift}::interval, ends_at = ends_at + ${shift}::interval
      where id in ${sql(ids)}`;
    await sql`update public.court_bookings set starts_at = starts_at + ${shift}::interval, ends_at = ends_at + ${shift}::interval
      where session_id in ${sql(ids)}`;
    await sql.end();
  }
  const idOf = (url) => url.split("/").pop();

  // Pastille UCPA de l'en-tête : menu avec le site de réservation et la carte 10 sessions
  await alice.getByRole("button", { name: "UCPA" }).click();
  const ucpa = alice.getByRole("list", { name: "Liens UCPA" });
  for (const [name, href] of [
    ["Réserver un terrain", "https://www.ucpa.com/groupesos/le-prisme/badminton"],
    ["Carte 10 sessions", "https://www.ucpa.com/groupesos/le-prisme/offre/carte-10-sessions-de-badminton"],
  ]) {
    const link = ucpa.getByRole("link", { name });
    if ((await link.getAttribute("href")) !== href || (await link.getAttribute("target")) !== "_blank")
      throw new Error(`Lien UCPA « ${name} » incorrect`);
  }
  await alice.keyboard.press("Escape");
  await ucpa.waitFor({ state: "detached" });
  ok("la pastille UCPA de l'accueil ouvre les liens de réservation et de la carte 10 sessions");

  await alice.click('a[aria-label="Nouvelle réservation"]');
  if ((await alice.inputValue('input[name="venue"]')) !== "Le Prisme, Bobigny") throw new Error("Gymnase par défaut incorrect");
  if ((await alice.inputValue('input[name="start"]')) !== "20:00") throw new Error("Heure par défaut incorrecte");
  await alice.waitForSelector("text=20:00 – 22:00 · Le Prisme, Bobigny");
  await alice.click('label:has(input[value="6"])');
  await alice.click('label:has(input[value="9"])');
  // Tarif carte 10 sessions du Prisme : 4,50 €/h avec carte, 5 €/h sans, et 5 €/h de supplément
  // si le capitaine est seul.
  const detail = alice.getByLabel("Détail du prix");
  await detail.getByText("Supplément : 2e joueur absent").waitFor();
  await detail.getByText("19,00 € · 9,50 €/h").waitFor();
  await alice.getByRole("button", { name: "Réserver 2 terrains · 38,00 €" }).waitFor();
  if (await alice.locator('input[name="price"]').count()) throw new Error("Pas de prix à saisir au tarif carte");
  await alice.getByText("+ Ajouter le 2e joueur").click();
  await alice.getByLabel("2e joueur", { exact: true }).selectOption({ label: "bob" });
  await detail.getByText("18,00 € · 9,00 €/h").waitFor();
  await alice.getByRole("button", { name: "Réserver 2 terrains · 36,00 €" }).waitFor();
  await alice.getByLabel("Carte 10 sessions du 2e joueur").uncheck();
  await detail.getByText("bob (sans carte)").waitFor();
  await alice.getByRole("button", { name: "Réserver 2 terrains · 38,00 €" }).waitFor();
  await alice.getByLabel("Carte 10 sessions du capitaine").uncheck();
  await alice.getByRole("button", { name: "Réserver 2 terrains · 40,00 €" }).waitFor();
  await alice.getByRole("button", { name: "Modifier" }).click();
  await alice.fill('input[name="end"]', "21:30");
  await alice.getByRole("button", { name: "Réserver 2 terrains · 30,00 €" }).waitFor();
  ok("tarif carte au Prisme : 9,50 €/h seul avec carte, 9 €/h à deux avec carte, 5 €/h par réservant sans carte, suit la durée");
  await alice.getByRole("button", { name: "Saisir un montant" }).click();
  if ((await alice.inputValue('input[name="price"]')) !== "15,00") throw new Error("Le montant libre ne part pas du prix au tarif carte");
  await alice.fill('input[name="price"]', "12,50");
  await alice.fill('input[name="end"]', "22:00");
  if ((await alice.inputValue('input[name="price"]')) !== "12,50") throw new Error("Le prix saisi a été écrasé par le prix par défaut");
  await alice.getByRole("button", { name: "Réserver 2 terrains · 25,00 €" }).waitFor();
  if (await alice.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error("La page Nouvelle réservation déborde sur la largeur d'un téléphone");
  await alice.getByRole("button", { name: "Revenir au tarif carte 10 sessions" }).click();
  await alice.getByRole("button", { name: "Réserver 2 terrains · 40,00 €" }).waitFor();
  await alice.fill('input[name="venue"]', VENUE);
  if ((await alice.inputValue('input[name="price"]')) !== "18,00") throw new Error("Prix par défaut incorrect hors du Prisme (9 € l'heure attendu)");
  if (await alice.getByText("Saisir un montant").count()) throw new Error("Tarif carte proposé hors du Prisme");
  ok("montant libre sur demande au Prisme, et seul choix dans un autre gymnase ; total affiché sur le bouton");
  await alice.fill('input[name="price"]', "2000");
  await alice.getByRole("button", { name: /^Réserver/ }).click();
  await alice.waitForSelector("text=Le prix d'un terrain ne peut pas dépasser 1 000 €.");
  ok("un prix de terrain au-delà de 1 000 € est refusé");
  const evening = await newBooking(alice, { courts: [6, 9], price: "12,50" });
  await alice.waitForSelector(`text=20:00 – 22:00 · ${VENUE}`);
  await stat(alice, "Terrains", "6 · 9").waitFor();
  await stat(alice, "Joueurs", "1 / 8").waitFor();
  ok("alice réserve les terrains 6 et 9 (20:00 – 22:00 par défaut) et s'inscrit : 1/8 joueurs");
  const first = await waitWhatsApp("🟢 *TERRAINS RÉSERVÉS*\n▎ alice · terrains 6 et 9\n▎ ", "\n▎ Terrains : 6 · 9\n▎ " + VENUE + " · 7 places restantes\n", evening);
  if (whatsapp.length !== 1) throw new Error(`Un seul message attendu pour deux terrains, reçu ${whatsapp.length}`);
  if (!/\n▎ \*[^*\n]+, 20:00 – 22:00\*\n/.test(first)) throw new Error(`Créneau absent ou pas en gras dans le message : ${first}`);
  ok("le groupe WhatsApp reçoit un seul message : terrains 6 et 9, créneau en gras, gymnase, 7 places restantes et le lien");

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
  await waitWhatsApp("👋 bob se désinscrit\n", ", 20:00 – 22:00 · " + VENUE + "\nPlaces restantes : 7\n", evening);
  ok("le groupe WhatsApp est prévenu de la désinscription de bob, avec les places restantes");
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
  if ((await addBooking.locator('input[name="price"]').inputValue()) !== "18,00") throw new Error("Prix par défaut incorrect dans Ajouter un terrain");
  await addBooking.locator('input[name="end"]').fill("21:00");
  if ((await addBooking.locator('input[name="price"]').inputValue()) !== "9,00") throw new Error("Le prix d'Ajouter un terrain ne suit pas la durée");
  await addBooking.locator('input[name="end"]').fill("22:00");
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
  await waitWhatsApp("🟢 *TERRAIN RÉSERVÉ*\n▎ bob et alice · terrain 10\n", "▎ Terrains : 6 · 9 · 10\n", " · 10 places restantes\n");
  ok("le groupe WhatsApp est prévenu du terrain 10, au nom de ses deux payeurs (bob et alice)");
  ok("le bouton OK de Gérer enregistre la note et revient à la session");

  // Historique : les 4 derniers événements sur la page de la session, tout le fil sur sa page.
  const historique = bob.locator("section", { has: bob.locator('h2:text-is("Historique")') });
  await historique.getByText("bob a modifié la session").waitFor();
  await historique.getByText("bob et alice ont réservé le terrain 10").waitFor();
  await historique.getByText("bob s'est désinscrit").waitFor();
  if ((await historique.locator("li").count()) !== 4) throw new Error("La page de la session doit montrer 4 événements");
  await historique.getByText(/^Créée aujourd'hui à \d\d:\d\d par alice$/).waitFor();
  await historique.getByRole("link", { name: "Tout voir (9)" }).click();
  // La page précédente reste chargée (cachée) : on ne regarde que le fil visible.
  const fil = bob.locator("ol").filter({ visible: true });
  await fil.getByText("alice a créé la session").waitFor();
  await fil.getByText("alice a réservé le terrain 6").waitFor();
  await fil.getByText("Note : « Volants fournis »").waitFor();
  await fil.getByText("Aujourd'hui", { exact: true }).waitFor();
  await bob.getByText(/^Créée aujourd'hui à \d\d:\d\d par alice$/).filter({ visible: true }).waitFor();
  if ((await fil.locator("> li").count()) !== 9) throw new Error("La page Historique doit montrer les 9 événements");
  await bob.getByRole("link", { name: "Terrains", exact: true }).filter({ visible: true }).click();
  await fil.getByText("bob s'est désinscrit").waitFor({ state: "detached" });
  await fil.getByText("alice a réservé le terrain 9").waitFor();
  if ((await fil.locator("> li").count()) !== 3) throw new Error("Le filtre Terrains doit garder les 3 réservations");
  await bob.getByRole("link", { name: "Retour" }).filter({ visible: true }).click();
  await stat(bob, "Joueurs", "2 / 12").waitFor();
  ok("l'historique montre la date de création, création, terrains, inscriptions, désinscription et note, avec un filtre par type");

  // QR code
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await bob.click('a:text-is("Gérer")');
  // Un QR code par heure : le terrain 6 de 20:00 à 22:00 en demande deux.
  const terrain6 = bob.locator("div.p-4", { has: bob.locator('span:text-is("Terrain 6")') });
  await terrain6.getByRole("button", { name: "Ajouter le QR code · 20:00 – 21:00" }).waitFor();
  await terrain6.getByRole("button", { name: "Ajouter le QR code · 21:00 – 22:00" }).waitFor();
  await terrain6.getByLabel("Fichier du QR code · 20:00 – 21:00").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
  await terrain6.getByRole("button", { name: "Remplacer le QR code · 20:00 – 21:00" }).waitFor();
  await terrain6.getByRole("button", { name: "Ajouter le QR code · 21:00 – 22:00" }).waitFor();
  const qrLinks = alice.locator("section", { hasText: "QR codes d'entrée" }).getByRole("button", { name: /Terrain 6/ });
  await qrLinks.filter({ hasText: "20:00" }).waitFor({ timeout: 10000 });
  await terrain6.getByLabel("Fichier du QR code · 21:00 – 22:00").setInputFiles({ name: "qr2.png", mimeType: "image/png", buffer: png });
  await terrain6.getByRole("button", { name: "Remplacer le QR code · 21:00 – 22:00" }).waitFor();
  await qrLinks.filter({ hasText: "21:00" }).waitFor({ timeout: 10000 });
  if ((await terrain6.getByRole("button", { name: "Remplacer" }).count()) !== 2)
    throw new Error("Le terrain 6 devrait avoir ses deux QR codes, un par heure");
  ok("bob ajoute un QR code par heure du terrain 6 (20:00 et 21:00), alice les voit en temps réel");
  // Un clic sur un QR code l'ouvre dans une fenêtre par-dessus la page, sans nouvel onglet
  const pagesAvant = alice.context().pages().length;
  await qrLinks.filter({ hasText: "20:00" }).click();
  const fenetre = alice.getByRole("dialog", { name: /Terrain 6 · 20:00/ });
  await fenetre.getByRole("img").waitFor();
  if (alice.context().pages().length !== pagesAvant) throw new Error("Le QR code ne doit pas ouvrir de nouvel onglet");
  await fenetre.getByRole("button", { name: "Fermer" }).click();
  await fenetre.waitFor({ state: "hidden" });
  await qrLinks.filter({ hasText: "21:00" }).click();
  await alice.getByRole("dialog", { name: /21:00/ }).waitFor();
  await alice.keyboard.press("Escape");
  await alice.getByRole("dialog", { name: /21:00/ }).waitFor({ state: "hidden" });
  await qrLinks.filter({ hasText: "20:00" }).click();
  await fenetre.waitFor();
  await alice.mouse.click(5, 5);
  await fenetre.waitFor({ state: "hidden" });
  ok("alice ouvre un QR code dans une fenêtre et la ferme par la croix, Échap ou un clic à côté");
  // L'image est servie par le site aux seuls joueurs connectés, avec son vrai type
  const qrSrc = await alice.locator("dialog img").first().getAttribute("src");
  if (!qrSrc?.startsWith("/api/qr?chemin=")) throw new Error(`Adresse du QR code inattendue : ${qrSrc}`);
  const qrRes = await alice.context().request.get(APP + qrSrc);
  const qrBody = await qrRes.body();
  if (qrRes.status() !== 200 || qrRes.headers()["content-type"] !== "image/png" || qrRes.headers()["x-content-type-options"] !== "nosniff" || !qrBody.equals(png))
    throw new Error(`QR code mal servi : ${qrRes.status()} ${qrRes.headers()["content-type"]}`);
  const qrAnonyme = await stranger.context().request.get(APP + qrSrc, { maxRedirects: 0 });
  if (qrAnonyme.status() === 200) throw new Error("Un visiteur non connecté ne doit pas voir les QR codes");
  ok("l'image du QR code est servie aux joueurs connectés (type vérifié), pas aux visiteurs");
  // En-têtes de sécurité : le site ne s'affiche dans un cadre que chez lui (QR codes en PDF).
  const home = await alice.context().request.get(APP + "/");
  const csp = home.headers()["content-security-policy"] ?? "";
  if (!csp.includes("frame-ancestors 'self'") || home.headers()["x-frame-options"] !== "SAMEORIGIN" || !home.headers()["strict-transport-security"])
    throw new Error(`En-têtes de sécurité absents : ${JSON.stringify(home.headers())}`);
  if (qrRes.headers()["x-frame-options"] !== "SAMEORIGIN") throw new Error("Le QR code doit pouvoir s'afficher dans un cadre du site seulement");
  ok("le site ne peut pas être affiché dans un cadre par un autre site (en-têtes de sécurité)");
  // Supprimer le QR code d'une heure ne touche pas à l'autre
  await terrain6.getByRole("button", { name: "Supprimer le QR code · 21:00 – 22:00" }).click();
  await terrain6.getByRole("button", { name: "Ajouter le QR code · 21:00 – 22:00" }).waitFor();
  await terrain6.getByRole("button", { name: "Remplacer le QR code · 20:00 – 21:00" }).waitFor();
  await qrLinks.filter({ hasText: "21:00" }).waitFor({ state: "detached", timeout: 10000 });
  ok("supprimer le QR code de 21:00 garde celui de 20:00");
  // Un fichier qui n'est pas une image (page web renommée en .png) est refusé
  await terrain6.getByLabel("Fichier du QR code · 21:00 – 22:00").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await terrain6.getByText("Échec, réessayez.").waitFor();
  await terrain6.getByRole("button", { name: "Ajouter le QR code · 21:00 – 22:00" }).waitFor();
  ok("un fichier qui n'est pas une image ni un PDF est refusé comme QR code");

  // Coller un QR code copié (depuis Gmail par exemple)
  await bob.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await bob.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }, png.toString("base64"));
  await terrain6.getByRole("button", { name: "Coller le QR code · 21:00 – 22:00" }).click();
  await terrain6.getByRole("button", { name: "Remplacer le QR code · 21:00 – 22:00" }).waitFor();
  await qrLinks.filter({ hasText: "21:00" }).waitFor({ timeout: 10000 });
  ok("bob colle l'image copiée comme QR code de 21:00, alice le voit");
  await terrain6.getByRole("button", { name: "Supprimer le QR code · 21:00 – 22:00" }).click();
  await terrain6.getByRole("button", { name: "Ajouter le QR code · 21:00 – 22:00" }).waitFor();

  // Partager une image vers l'appli depuis le menu « Partager » d'Android (share_target du manifest)
  const share = (await (await fetch(APP + "/manifest.webmanifest")).json()).share_target;
  if (share?.action !== "/partager/recevoir" || share.method !== "POST" || share.params?.files?.[0]?.name !== "qr")
    throw new Error("manifest sans share_target : " + JSON.stringify(share));
  const gerer = bob.url();
  await bob.goto(APP + "/partager");
  await bob.getByText("Pour quel créneau ?").waitFor();
  await bob.evaluate(() => navigator.serviceWorker.ready);
  if (!(await bob.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await bob.reload();
  await bob.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  // Android envoie l'image comme ce formulaire ; le service worker la reçoit.
  await bob.evaluate(({ action, name }) => {
    const form = Object.assign(document.createElement("form"), { method: "post", action, enctype: "multipart/form-data" });
    form.innerHTML = `<input type="file" name="${name}" id="partage-test">`;
    document.body.append(form);
  }, { action: share.action, name: share.params.files[0].name });
  await bob.setInputFiles("#partage-test", { name: "qr-gmail.png", mimeType: "image/png", buffer: png });
  await bob.evaluate(() => document.querySelector("#partage-test").form.submit());
  await bob.getByAltText("QR code reçu").waitFor();
  await bob.getByLabel("Terrain 6 · 21:00 – 22:00", { exact: true }).check();
  if (!(await bob.locator("label", { hasText: "Terrain 6 · 20:00 – 21:00" }).getByText("déjà un QR code").count()))
    throw new Error("La page de partage devrait signaler que 20:00 a déjà un QR code");
  await bob.getByRole("button", { name: "Envoyer le QR code" }).click();
  await bob.waitForURL(evening);
  await qrLinks.filter({ hasText: "21:00" }).waitFor({ timeout: 10000 });
  await bob.goto(gerer);
  await terrain6.getByRole("button", { name: "Remplacer le QR code · 21:00 – 22:00" }).waitFor();
  await bob.goto(APP + "/partager");
  await bob.getByText("Pour quel créneau ?").waitFor();
  if (await bob.getByAltText("QR code reçu").count()) throw new Error("L'image partagée aurait dû être oubliée après l'envoi");
  ok("bob partage une image vers l'appli, choisit terrain 6 · 21:00 et le QR code est enregistré");
  await bob.goto(gerer);

  // Regroupement : un créneau qui suit rejoint la même session, celui de midi en crée une autre
  if ((await newBooking(alice, { courts: [7], start: "22:00", end: "23:00", price: "5" })) !== evening)
    throw new Error("La réservation de 22:00 aurait dû rejoindre la session du soir");
  await alice.waitForSelector(`text=20:00 – 23:00 · ${VENUE}`);
  await stat(alice, "Par joueur", "20,00 €").waitFor();
  await stat(alice, "Joueurs", "2 / 12").waitFor();
  ok("le terrain 7 de 22:00 à 23:00 rejoint la session du soir (20:00 – 23:00)");
  ok("4 terrains mais jamais plus de 3 à la fois : 12 places, pas 16");
  await waitWhatsApp(
    "🟢 *TERRAIN RÉSERVÉ*\n▎ alice · terrain 7 (22:00 – 23:00)\n",
    ", 20:00 – 23:00*\n",
    "▎ Terrains :\n▎ • 6 : 20:00 – 22:00\n▎ • 7 : 22:00 – 23:00\n▎ • 9 : 20:00 – 22:00\n▎ • 10 : 20:00 – 22:00\n",
    " · 10 places restantes\n",
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

  // Une seule place libre : bob la prend, son invité reste en liste d'attente.
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await alice.click('button[aria-label="Retirer carol"]');
  await alice.waitForSelector("text=Joueurs · 4 / 4");
  await alice.waitForSelector("text=· 1 invité en attente");
  await bob.waitForSelector("text=Votre invité est n°1 sur la liste d'attente", { timeout: 10000 });
  await bob.getByRole("list", { name: "Joueurs inscrits" }).getByText("bob", { exact: true }).waitFor();
  await bob.getByRole("list", { name: "Liste d'attente" }).getByText("invité de bob").waitFor();
  await stat(bob, "Joueurs", "4 / 4").waitFor();
  await waitMail("bob@test.fr", "Une place s'est libérée : vous jouez");
  ok("carol se désiste : une seule place, bob la prend et reçoit un e-mail, son invité reste en attente");

  await alice.click('button[aria-label="Retirer eve"]');
  await bob.locator("text=sur la liste d'attente").waitFor({ state: "detached", timeout: 10000 });
  await stat(bob, "Joueurs", "4 / 4").waitFor();
  await bob.getByRole("list", { name: "Joueurs inscrits" }).getByText("bob +1").waitFor();
  await bob.waitForSelector("text=Vous payez aussi la part de vos invités : 2 × 2,00 € = 4,00 €");
  await waitMail("bob@test.fr", "Une place s'est libérée : votre invité joue");
  ok("eve se désiste aussi : l'invité de bob joue (4/4), bob paie 2 parts et reçoit un e-mail");
  await bob.reload();
  const historiqueMidi = bob.locator("section", { has: bob.locator('h2:text-is("Historique")') });
  await historiqueMidi.getByText("bob passe de la liste d'attente aux joueurs", { exact: true }).waitFor();
  await historiqueMidi.getByText("L'invité de bob passe de la liste d'attente aux joueurs").waitFor();
  await historiqueMidi.getByText("alice a retiré eve").waitFor();
  await historiqueMidi.getByText("alice a retiré carol").waitFor();
  ok("l'historique note les joueurs retirés par alice, et le passage de bob puis de son invité aux joueurs");

  // Session complète : un 2e invité de bob va en fin de liste d'attente, bob garde sa place.
  await bob.selectOption('select[name="guests"]', "2");
  await bob.waitForSelector("text=Votre invité est n°1 sur la liste d'attente");
  if ((await bob.inputValue('select[name="guests"]')) !== "2") throw new Error("Le 2e invité de bob aurait dû être accepté");
  await bob.getByRole("list", { name: "Joueurs inscrits" }).getByText("bob +1").waitFor();
  await bob.getByRole("list", { name: "Liste d'attente" }).getByText("invité de bob").waitFor();
  await bob.waitForSelector("text=Vous payez aussi la part de vos invités : 2 × 2,00 € = 4,00 €");
  await stat(bob, "Joueurs", "4 / 4").waitFor();
  await waitWhatsApp(
    "🙋 bob vient avec 2 invités (1 en liste d'attente)\n",
    ", 12:00 – 13:00 · ",
    "Places restantes : 0 (1 en liste d'attente)\n",
    midday,
  );
  ok("session complète : le 2e invité de bob passe en liste d'attente, bob et son 1er invité gardent leur place");

  // Comptes. Soir : 40 € pour alice et bob, 20 € chacun ; alice a avancé 35 €, bob 5 €.
  // Midi : 8 € pour dave, frank, bob et son 1er invité (le 2e attend), 2 € la place, avancés par alice.
  // → bob doit 15 + 2 × 2 = 19 € à alice ; dave et frank lui doivent 2 € chacun.
  // Tant que ces sessions sont à venir, elles ne comptent pas : tout le monde est à jour.
  await bob.goto(APP + "/comptes");
  await bob.waitForSelector("text=Vous êtes à jour");
  {
    const sql = postgres(process.env.ADMIN_DB_URL, { max: 1 });
    const ids = (await sql`select id from public.sessions where venue = ${VENUE} and cancelled_at is null`).map((r) => r.id);
    await sql.end();
    if (ids.length !== 2) throw new Error(`Sessions du soir et de midi attendues, trouvé ${ids.length}`);
    await shiftSessions(ids, -7);
  }
  ok("les sessions à venir ne comptent pas dans les comptes, elles comptent une fois terminées");
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
  await waitWhatsApp("🟢 *TERRAINS RÉSERVÉS*\n▎ Alice · terrains 11 et 12\n", " · 7 places restantes\n");
  // 2 heures sur le terrain 11, 1 heure sur le 12 : chaque terrain avec ses horaires.
  if ((await newBooking(alice, { courts: [11], start: "18:00", end: "19:00", price: "6", payer: "bob" })) !== later)
    throw new Error("Le terrain 11 de 18:00 à 19:00 aurait dû rejoindre la session de 17:00");
  await waitWhatsApp(
    "🟢 *TERRAIN RÉSERVÉ*\n▎ bob · terrain 11 (18:00 – 19:00)\n",
    ", 17:00 – 19:00*\n",
    "▎ Terrains :\n▎ • 11 : 17:00 – 19:00\n▎ • 12 : 17:00 – 18:00\n",
    " · 6 places restantes\n",
  );
  await stat(alice, "Joueurs", "2 / 8").waitFor();
  await alice.getByRole("list", { name: "Joueurs inscrits" }).getByText("bob").waitFor();
  ok("bob, payeur du terrain 11 réservé par alice, est inscrit automatiquement à la session");
  ok("2 h sur le terrain 11 et 1 h sur le 12 : le message WhatsApp donne les horaires de chaque terrain");
  ok("alice réserve le terrain 11 en indiquant bob comme payeur : le message WhatsApp est au nom de bob");
  // bob ajoute puis retire des invités : le groupe voit les places restantes à jour.
  await bob.goto(later);
  await bob.selectOption('select[name="guests"]', "3");
  await waitWhatsApp("🙋 bob vient avec 3 invités\n", ", 17:00 – 19:00 · ", "Places restantes : 3\n", later);
  await stat(bob, "Joueurs", "5 / 8").waitFor();
  await bob.selectOption('select[name="guests"]', "0");
  await waitWhatsApp("🙋 bob vient sans invité\n", "Places restantes : 6\n", later);
  await stat(bob, "Joueurs", "2 / 8").waitFor();
  ok("bob ajoute 3 invités puis les retire : le groupe WhatsApp reçoit les places restantes à jour");
  await alice.click('a:text-is("Gérer")');
  alice.once("dialog", (d) => d.accept());
  await alice.click('button[aria-label="Retirer le terrain 12 (17:00 – 18:00)"]');
  await alice.waitForSelector("text=Joueurs · 2 / 4");
  await waitWhatsApp("🔴 *TERRAIN ANNULÉ*\n▎ Alice · terrain 12 (17:00 – 18:00)\n", "▎ Terrains : 11\n", " · 2 places restantes\n", later);
  ok("alice retire le terrain 12 : le groupe WhatsApp reçoit l'annulation et les places restantes");

  // Prix corrigé après coup : terrain 11 de 18:00 à 19:00 (payé par bob) passe de 6 € à 10 €.
  // Session : 16 € pour alice et bob, 8 € chacun → alice -2 €, bob +2 € (il était déjà à +2 €).
  await bob.goto(later);
  await stat(bob, "Par joueur", "6,00 €").waitFor();
  const price = alice.locator('input[aria-label="Prix du terrain 11 (18:00 – 19:00)"]');
  await alice.locator("details", { has: price }).locator("summary").click();
  if ((await price.inputValue()) !== "6,00") throw new Error("Le prix actuel du terrain n'est pas prérempli");
  await price.fill("1500");
  await price.press("Enter");
  await alice.waitForSelector("text=Le prix d'un terrain ne peut pas dépasser 1 000 €.");
  await price.fill("10");
  await price.press("Enter");
  await alice.waitForSelector("text=Terrains · 16,00 €");
  await alice.waitForSelector("text=18:00 – 19:00 · 10,00 € · payé par bob");
  await stat(bob, "Par joueur", "8,00 €").waitFor({ timeout: 10000 });
  // La session est à venir : les comptes de bob n'ont pas bougé tant qu'elle n'est pas terminée.
  await bob.goto(APP + "/comptes");
  await bob.waitForSelector("text=On vous doit 2,00 €");
  await shiftSessions([idOf(later)], -7);
  await bob.reload();
  await bob.waitForSelector("text=On vous doit 4,00 €");
  await shiftSessions([idOf(later)], 7);
  ok("alice corrige le prix d'un terrain déjà réservé (au-delà de 1 000 € refusé) : part et comptes recalculés, bob le voit en temps réel");
  alice.once("dialog", (d) => d.accept());
  await alice.getByRole("button", { name: "Supprimer la session" }).click();
  await alice.waitForURL(APP + "/");
  await waitWhatsApp("❌ *SESSION SUPPRIMÉE*\nAlice a supprimé la session\n", ", 17:00 – 19:00 · " + VENUE, "Terrains : 11", later);
  ok("alice supprime la session : le groupe WhatsApp est prévenu, avec le lien de la session");
  // La session annulée reste consultable, sans rien pour la modifier ni s'y inscrire.
  await bob.goto(later);
  await bob.waitForSelector("text=Session annulée par Alice le");
  await stat(bob, "Terrain", "11").waitFor();
  if (await bob.locator('a:text-is("Gérer")').count() || (await bob.getByRole("button", { name: /inscri/ }).count()))
    throw new Error("Une session annulée ne doit plus pouvoir être modifiée");
  await bob.goto(later + "/historique");
  await bob.waitForSelector("text=Alice a supprimé la session");
  ok("bob ouvre le lien : la session annulée reste consultable, avec son historique, mais n'est plus modifiable");

  // Tarif carte au Prisme, de bout en bout : alice capitaine avec carte, bob 2e joueur avec carte.
  // bob est à +2 € avant. Chaque changement de payeurs recalcule le prix et la part avancée par chacun.
  await bob.goto(APP + "/comptes");
  await bob.waitForSelector("text=On vous doit 2,00 €");
  await alice.goto(APP + "/");
  await alice.click('a[aria-label="Nouvelle réservation"]');
  await alice.click('button[aria-label="Autre date"]');
  await alice.fill('input[type="date"]', DATE);
  // Le gymnase proposé est le dernier utilisé : on revient au Prisme.
  await alice.getByRole("button", { name: "Modifier" }).click();
  await alice.fill('input[name="venue"]', "Le Prisme, Bobigny");
  await alice.click('label:has(input[value="13"])');
  await alice.getByText("+ Ajouter le 2e joueur").click();
  await alice.getByLabel("2e joueur", { exact: true }).selectOption({ label: "bob" });
  await alice.getByRole("button", { name: "Réserver 1 terrain · 18,00 €" }).click();
  await alice.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
  const prisme = idOf(alice.url());
  await stat(alice, "Par joueur", "9,00 €").waitFor();
  await alice.click('a:text-is("Gérer")');
  await alice.waitForSelector("text=20:00 – 22:00 · 18,00 € · Alice carte + bob carte");
  ok("alice réserve au Prisme avec bob, tous deux avec carte : 18 € pour 2 h, bob est inscrit");
  // bob se désiste : alice est seule et paie le supplément ; bob doit sa part de 19 €.
  await alice.getByRole("button", { name: "Retirer bob (2e joueur)" }).click();
  await alice.waitForSelector("text=20:00 – 22:00 · 19,00 € · Alice carte · seul");
  await alice.waitForSelector("text=Supplément de 5 € l'heure pour le 2e joueur absent");
  await shiftSessions([prisme], -7);
  await bob.reload();
  await bob.waitForSelector("text=Vous devez 7,50 €");
  await shiftSessions([prisme], 7);
  // bob revient, sans carte : il avance 10 €, alice 9 € ; chacun doit 9,50 €.
  const label13 = "terrain 13 (20:00 – 22:00)";
  const partner13 = alice.getByLabel(`2e joueur · ${label13}`);
  const payers13 = alice.locator("details", { has: partner13 });
  await payers13.locator("summary").click();
  await partner13.selectOption({ label: "bob" });
  await alice.getByLabel(`Carte 10 sessions du 2e joueur · ${label13}`).uncheck();
  await payers13.getByRole("button", { name: "Enregistrer" }).click();
  await alice.waitForSelector("text=20:00 – 22:00 · 19,00 € · Alice carte + bob sans carte");
  await shiftSessions([prisme], -7);
  await bob.reload();
  await bob.waitForSelector("text=On vous doit 2,50 €");
  ok("le 2e joueur se désiste puis revient sans carte : prix recalculé (19 €) et chacun crédité de sa part exacte (10 € et 9 €)");

  // Écran de chargement : le HTML envoyé avant les données contient le squelette de la page.
  for (const path of ["/", "/comptes", "/profil"]) {
    const html = await (await alice.context().request.get(APP + path)).text();
    if (!html.includes('role="status"') || !html.includes('aria-label="Chargement"')) throw new Error(`pas de squelette de chargement sur ${path}`);
  }
  ok("pendant le chargement, les pages affichent un squelette gris à la place du texte « Chargement… »");

  // Récap hebdomadaire des comptes (appelé par GitHub Actions le lundi à 23 h) : refusé sans le secret.
  const recapUrl = APP + "/api/cron/recap-comptes";
  const denied = await fetch(recapUrl, { redirect: "manual" });
  if (denied.status !== 401) throw new Error(`Récap sans secret : 401 attendu, reçu ${denied.status}`);
  const auth = { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } };
  const sent = await (await fetch(recapUrl, auth)).json();
  if (!sent.sent) throw new Error(`Récap non envoyé : ${JSON.stringify(sent)}`);
  const recap = await waitWhatsApp("💰 *RÉCAP DES COMPTES*\n", "/comptes");
  if (!/\n• \S+ → \S+ : \*[\d\s,]+€\*/.test(recap) && !recap.includes("Tout le monde est à jour"))
    throw new Error(`Récap sans virements : ${recap}`);
  ok("le récap hebdomadaire des comptes part dans le groupe WhatsApp (refusé sans le secret de la tâche planifiée)");

  // Rappel des terrains vides à 72h (route appelée toutes les heures par GitHub Actions).
  // Les sessions sont créées directement en base, à quelques heures près.
  const seedDb = postgres(process.env.ADMIN_DB_URL, { max: 1 });
  // Deux joueurs quelconques (alice a changé de nom plus haut).
  const [p1, p2] = (await seedDb`select id from public.profiles order by created_at`).map((p) => p.id);
  const at = (h) => new Date(Math.round((Date.now() + h * 3600e3) / 3600e3) * 3600e3).toISOString();
  async function seedSession(venue, inHours, courts, players) {
    const [s] = await seedDb`insert into public.sessions (venue, starts_at, ends_at, created_by)
      values (${venue}, ${at(inHours)}, ${at(inHours + 2)}, ${p1}) returning id, starts_at, ends_at`;
    for (const court of courts)
      await seedDb`insert into public.court_bookings (session_id, court, price_cents, booked_by, created_by, starts_at, ends_at)
        values (${s.id}, ${court}, 1800, ${p1}, ${p1}, ${s.starts_at}, ${s.ends_at})`;
    for (const [player_id, guests] of players)
      await seedDb`insert into public.session_participants (session_id, player_id, guests) values (${s.id}, ${player_id}, ${guests})`;
    return s.id;
  }
  const missing4 = await seedSession(VENUE + " rappel", 60, [6, 9], [[p1, 0], [p2, 2]]);
  const others = [
    await seedSession(VENUE + " complet", 60, [6], [[p1, 3]]),
    await seedSession(VENUE + " 3 manquants", 60, [6, 9], [[p1, 4]]),
    await seedSession(VENUE + " trop tôt", 80, [6, 9], []),
    await seedSession(VENUE + " trop tard", 30, [6, 9], []),
  ];
  await seedDb.end();
  const cron = (secret) => fetch(APP + "/api/cron/rappel-terrains-vides", { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
  if ((await cron()).status !== 401 || (await cron("mauvais")).status !== 401) throw new Error("La route du rappel doit refuser un appel sans le bon secret");
  const before = whatsapp.length;
  const run1 = await (await cron(process.env.CRON_SECRET)).json();
  if (!run1.sent.includes(missing4) || others.some((id) => run1.sent.includes(id))) throw new Error(`Rappel attendu pour la seule session à moitié vide : ${JSON.stringify(run1)}`);
  const reminder = await waitWhatsApp("⏰ *IL MANQUE 4 JOUEURS*\n▎ ", "\n▎ Terrains : 6 · 9\n▎ " + VENUE + " rappel · 4 inscrits pour 8 places\n", "on joue en simple, ou un capitaine annule son terrain avant ", "(48h avant)", `/sessions/${missing4}`);
  const deadline = new Date(Date.parse(at(60)) - 48 * 3600e3);
  const parisTime = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(deadline);
  if (!reminder.includes(` à ${parisTime} (48h avant)`)) throw new Error(`Limite d'annulation incorrecte (${parisTime} attendu) : ${reminder}`);
  const run2 = await (await cron(process.env.CRON_SECRET)).json();
  await sleep(500);
  if (run2.sent.length || whatsapp.length !== before + run1.sent.length) throw new Error(`Le rappel ne doit partir qu'une fois : ${JSON.stringify(run2)}`);
  ok("72h avant, le groupe WhatsApp est prévenu une seule fois s'il manque 4 joueurs (limite d'annulation à 48h), pas s'il en manque moins de 4 ni hors délai");

  // Limites de la page de connexion : 30 e-mails par heure en tout, 10 demandes par heure et par adresse IP.
  {
    const sql = postgres(process.env.DATABASE_URL, { max: 1 });
    const page = await (await browser.newContext()).newPage();
    await page.goto(APP + "/login");
    const ask = async (email) => {
      await page.fill("#email", email);
      const answered = page.waitForResponse((r) => r.request().method() === "POST");
      await page.click("text=Recevoir un lien de connexion");
      await answered;
      await page.locator("button:text-is('Recevoir un lien de connexion'):enabled").waitFor();
      return page.getByRole("status").innerText();
    };
    // 30 e-mails déjà partis dans l'heure (faux, insérés en base) : plus aucun e-mail, même pour un joueur.
    const fake = await sql`
      insert into public.login_tokens (user_id, link_hash, code_hash, expires_at)
      select id, md5(random()::text) || n, '', now() + interval '1 hour'
      from auth.users, generate_series(1, 30) as n where email = 'frank@test.fr'
      returning id`;
    try {
      if (!(await ask("eve@test.fr")).includes("Trop d'e-mails de connexion envoyés en ce moment"))
        throw new Error("Au-delà de 30 e-mails de connexion par heure, plus aucun ne doit partir");
    } finally {
      await sql`update public.login_tokens set created_at = now() - interval '2 hours', used_at = now()
                where id = any(${fake.map((r) => r.id)})`;
    }
    let refusedAt = 0;
    for (let i = 1; i <= 12 && !refusedAt; i++) {
      if ((await ask(`inconnu${i}@test.fr`)).includes("Trop de demandes depuis cette connexion")) refusedAt = i;
    }
    if (!refusedAt || refusedAt === 1) throw new Error("La 11e demande d'e-mail de l'heure depuis une même adresse IP doit être refusée");
    await Promise.all([page.context().close(), sql.end()]);
    ok("au plus 30 e-mails de connexion par heure en tout, et 10 demandes par heure depuis une même adresse IP");
  }

  if (errors.length) throw new Error("Erreurs dans le navigateur :\n" + errors.join("\n"));
  console.log("\nTous les tests sont passés.");
} finally {
  await browser.close();
  greenApi.close();
}
