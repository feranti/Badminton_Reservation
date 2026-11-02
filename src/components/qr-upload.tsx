"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { canPasteImage, readClipboardImage, uploadQr } from "@/lib/qr-upload";
import { UploadIcon } from "./icons";

const noSubscribe = () => () => {};
const action = "inline-flex min-h-11 items-center gap-1.5 text-sm disabled:opacity-60";

// Boutons d'une tuile QR code (une heure de terrain) :
// « Ajouter » ouvre les photos ou captures d'écran, « Coller » reprend une image copiée
// (depuis Gmail par exemple), « Remplacer » quand il y a déjà un QR code.
// L'image va directement dans le stockage privé de Supabase.
// hour : rang de l'heure dans la réservation ; label : l'heure, pour les noms accessibles.
// children : actions placées avant (Voir).
export function QrUpload({
  bookingId,
  hour,
  hasQr,
  label,
  children,
}: {
  bookingId: string;
  hour: number;
  hasQr: boolean;
  label?: string;
  children?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "empty">("idle");
  const pasteable = useSyncExternalStore(noSubscribe, canPasteImage, () => false);
  const suffix = label ? ` · ${label}` : "";

  async function upload(file: Blob, name?: string) {
    setStatus("uploading");
    setStatus((await uploadQr(bookingId, hour, file, name)) ? "idle" : "error");
  }

  async function paste() {
    const file = await readClipboardImage();
    if (file) await upload(file, file.name);
    else setStatus("empty");
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        aria-label={`Fichier du QR code${suffix}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file, file.name);
          e.target.value = "";
        }}
      />
      <span className="flex flex-wrap items-center gap-x-3">
        {status === "uploading" ? (
          <span className={`${action} text-muted`}>Envoi…</span>
        ) : (
          <>
            {children}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label={`${hasQr ? "Remplacer" : "Ajouter"} le QR code${suffix}`}
              className={hasQr ? `${action} text-muted hover:text-ink` : `${action} font-medium text-accent`}
            >
              {!hasQr && <UploadIcon className="size-4" />}
              {hasQr ? "Remplacer" : "Ajouter"}
            </button>
            {pasteable && !hasQr && (
              <button
                type="button"
                onClick={() => void paste()}
                aria-label={`Coller le QR code${suffix}`}
                className={`${action} text-muted hover:text-ink`}
              >
                Coller
              </button>
            )}
          </>
        )}
      </span>
      {status === "error" && <span className="text-sm text-danger">Échec, réessayez.</span>}
      {status === "empty" && <span className="text-sm text-danger">Aucune image copiée.</span>}
    </>
  );
}
