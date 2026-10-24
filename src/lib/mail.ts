import nodemailer from "nodemailer";

// Envoi d'e-mails par SMTP (Gmail avec mot de passe d'application, Brevo…).
// Sans configuration, les e-mails sont seulement écrits dans le journal du serveur.
export async function sendMail({ to, subject, text }: { to: string; subject: string; text: string }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST) {
    console.info(`[e-mail non envoyé, SMTP non configuré] à ${to} : ${subject}`);
    return;
  }
  const port = Number(SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: MAIL_FROM ?? SMTP_USER, to, subject, text });
}
