import { setQrPath } from "@/app/sessions/actions";
import { createClient } from "@/lib/supabase/client";

// Envoie l'image du QR code d'une heure de terrain dans le stockage privé de Supabase.
// Renvoie false si l'envoi a échoué.
export async function uploadQr(bookingId: string, hour: number, file: Blob, name = "qr.png") {
  const ext = (name.split(".").pop() || "png").toLowerCase();
  const path = `${bookingId}/${hour}-${Date.now()}.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("qr-codes").upload(path, file, { contentType: file.type });
  if (error) return false;
  await setQrPath(bookingId, hour, path);
  return true;
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
