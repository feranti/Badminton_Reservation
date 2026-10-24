"use client";

import { useRef, useState } from "react";
import { setQrPath } from "@/app/sessions/actions";
import { createClient } from "@/lib/supabase/client";

// Bouton « Ajouter le QR code » : ouvre les photos ou captures d'écran du téléphone
// et envoie l'image directement dans le stockage privé de Supabase.
export function QrUpload({ bookingId, hasQr }: { bookingId: string; hasQr: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");

  async function upload(file: File) {
    setStatus("uploading");
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${bookingId}/${Date.now()}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("qr-codes").upload(path, file, { contentType: file.type });
    if (error) {
      setStatus("error");
      return;
    }
    await setQrPath(bookingId, path);
    setStatus("idle");
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        aria-label="Fichier du QR code"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === "uploading"}
        className="text-sm text-emerald-700 hover:underline disabled:opacity-60 dark:text-emerald-400"
      >
        {status === "uploading" ? "Envoi…" : hasQr ? "Remplacer le QR code" : "Ajouter le QR code"}
      </button>
      {status === "error" && <span className="text-sm text-red-600">Envoi impossible, réessayez.</span>}
    </>
  );
}
