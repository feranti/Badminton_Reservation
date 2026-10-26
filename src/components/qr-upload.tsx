"use client";

import { useRef, useState } from "react";
import { setQrPath } from "@/app/sessions/actions";
import { createClient } from "@/lib/supabase/client";
import { UploadIcon } from "./icons";

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
        className={
          hasQr
            ? "inline-flex min-h-11 items-center text-sm text-muted hover:text-ink disabled:opacity-60"
            : "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-dash text-[15px] disabled:opacity-60"
        }
      >
        {!hasQr && <UploadIcon />}
        {status === "uploading" ? "Envoi…" : hasQr ? "Remplacer" : "Ajouter le QR code"}
      </button>
      {status === "error" && <span className="text-sm text-danger">Envoi impossible, réessayez.</span>}
    </>
  );
}
