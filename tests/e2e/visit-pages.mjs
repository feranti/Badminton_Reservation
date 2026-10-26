// Se connecte et ouvre chaque page, pour faire apparaître les erreurs du serveur de développement.
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3001";
const MAIL = process.env.MAIL_URL ?? "http://127.0.0.1:54324";
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await (await browser.newContext()).newPage();
await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
await page.goto(APP + "/login");
await page.fill("#email", "alice@test.fr");
await page.click("text=Recevoir un lien de connexion");
await page.waitForSelector("text=Lien envoyé");
await new Promise((r) => setTimeout(r, 1500));
const list = await (await fetch(`${MAIL}/api/v1/search?query=to:alice@test.fr`)).json();
const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
await page.goto(msg.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&"));
await page.waitForSelector('nav[aria-label="Navigation principale"]');
for (const path of ["/", "/?passees=1", "/comptes", "/comptes/aide", "/profil", "/sessions/nouvelle"]) {
  await page.goto(APP + path);
  await page.waitForTimeout(1500);
}
await page.goto(APP + "/");
const session = page.locator('main a[href^="/sessions/"]:not([href$="/nouvelle"])').first();
if (await session.count()) {
  const href = await session.getAttribute("href");
  for (const path of [href, `${href}/gerer`]) {
    await page.goto(APP + path);
    await page.waitForTimeout(2000);
  }
}
await browser.close();
