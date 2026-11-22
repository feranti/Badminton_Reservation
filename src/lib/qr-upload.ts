import { uploadQr as uploadQrAction } from "@/app/sessions/actions";
import { QR_MAX_BYTES } from "@/lib/qr-image";

// Envoie l'image du QR code d'une heure de terrain au serveur, qui la garde dans la base.
// Renvoie false si l'envoi a échoué (fichier trop lourd, d'un type refusé, réseau…).
export async function uploadQr(bookingId: string, hour: number, file: Blob, name = "qr.png") {
  if (file.size === 0 || file.size > QR_MAX_BYTES) return false;
  const form = new FormData();
  form.set("booking_id", bookingId);
  form.set("hour", String(hour));
  form.set("file", file, name);
  try {
    return await uploadQrAction(form);
  } catch {
    return false;
  }
}

// Première image du presse-papiers (copiée depuis Gmail, les photos…), ou null.
export async function readClipboardImage(): Promise<File | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return new File([await item.getType(type)], `qr.${type.split("/")[1]}`, { type });
    }
  } catch {
    // Accès refusé ou presse-papiers vide.
  }
  return null;
}

// Le bouton « Coller » n'est proposé que si le navigateur sait lire une image copiée.
export function canPasteImage() {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";
}
