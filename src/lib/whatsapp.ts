// Envoi d'un message dans le groupe WhatsApp du club, par Green API (green-api.com).
// Green API garde la connexion WhatsApp d'un numéro relié par QR code ; l'appli lui envoie
// seulement une requête HTTP. Sans configuration, le message est seulement écrit dans le journal.
export async function sendToGroup(message: string) {
  const { GREEN_API_URL, GREEN_API_INSTANCE, GREEN_API_TOKEN, WHATSAPP_GROUP_ID } = process.env;
  if (!GREEN_API_URL || !GREEN_API_INSTANCE || !GREEN_API_TOKEN || !WHATSAPP_GROUP_ID) {
    console.info(`[WhatsApp non envoyé, Green API non configuré]\n${message}`);
    return;
  }
  const url = `${GREEN_API_URL.replace(/\/$/, "")}/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: WHATSAPP_GROUP_ID, message }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Green API a répondu ${response.status} : ${await response.text()}`);
}
