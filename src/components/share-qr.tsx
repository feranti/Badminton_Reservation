"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { canPasteImage, readClipboardImage, uploadQr } from "@/lib/qr-upload";
import { card, errorText, primaryButton, secondaryButton, sectionTitle } from "./ui";

export type QrSlot = { sessionId: string; bookingId: string; hour: number; label: string; hasQr: boolean };

// Image reçue du menu « Partager », gardée en cache par public/sw.js.
const CACHE = "partage";
const FICHIER = "/partager/fichier";
const noSubscribe = () => () => {};

export function ShareQr({ groups, failed }: { groups: { title: string; slots: QrSlot[] }[]; failed: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const slots = groups.flatMap((g) => g.slots);
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [choice, setChoice] = useState(() => {
    const s = slots.find((x) => !x.hasQr) ?? slots[0];
    return s ? `${s.bookingId}:${s.hour}` : "";
  });
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "empty">("idle");
  const pasteable = useSyncExternalStore(noSubscribe, canPasteImage, () => false);
  const preview = useMemo(() => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    // Lu après l'affichage : le serveur ne connaît pas le cache du téléphone.
    (typeof caches === "undefined" ? Promise.resolve(undefined) : caches.open(CACHE).then((cache) => cache.match(FICHIER)))
      .then(async (res) => {
        if (res) {
          const blob = await res.blob();
          const name = decodeURIComponent(res.headers.get("x-nom") ?? "") || "qr.png";
          setFile(new File([blob], name, { type: blob.type }));
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function send() {
    const slot = slots.find((s) => `${s.bookingId}:${s.hour}` === choice);
    if (!file || !slot) return;
    setStatus("uploading");
    if (!(await uploadQr(slot.bookingId, slot.hour, file, file.name))) {
      setStatus("error");
      return;
    }
    if (typeof caches !== "undefined") await caches.open(CACHE).then((c) => c.delete(FICHIER)).catch(() => {});
    router.push(`/sessions/${slot.sessionId}`);
  }

  async function paste() {
    const pasted = await readClipboardImage();
    if (pasted) {
      setFile(pasted);
      setStatus("idle");
    } else setStatus("empty");
  }

  if (slots.length === 0) {
    return <p className="py-10 text-center text-muted">Aucun terrain réservé à venir : réservez d&apos;abord un terrain.</p>;
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>QR code</h2>
        {failed && !file && <p className={errorText}>L&apos;image n&apos;a pas été reçue : partagez-la à nouveau.</p>}
        {file ? (
          <div className={`${card} flex items-center gap-3 p-3`}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="QR code reçu" className="size-20 rounded-lg object-contain" />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-lg bg-chip text-sm text-muted">PDF</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{file.name}</span>
          </div>
        ) : (
          loaded && <p className="text-muted">Choisissez l&apos;image du QR code, ou collez-la si vous l&apos;avez copiée.</p>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            aria-label="Fichier du QR code"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) setFile(picked);
              e.target.value = "";
            }}
          />
          <button type="button" className={secondaryButton} onClick={() => inputRef.current?.click()}>
            {file ? "Changer d'image" : "Choisir une image"}
          </button>
          {pasteable && (
            <button type="button" className={secondaryButton} onClick={() => void paste()}>
              Coller
            </button>
          )}
        </div>
        {status === "empty" && <p className={errorText}>Aucune image copiée.</p>}
      </section>

      <fieldset className="flex flex-col gap-4">
        <legend className={`${sectionTitle} mb-3`}>Pour quel créneau ?</legend>
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-1">
            <p className="text-[15px] font-semibold">{g.title}</p>
            {g.slots.map((s) => {
              const value = `${s.bookingId}:${s.hour}`;
              return (
                <label key={value} className="flex min-h-11 items-center gap-3 border-b border-line">
                  <input
                    type="radio"
                    name="creneau"
                    value={value}
                    checked={choice === value}
                    onChange={() => setChoice(value)}
                    className="size-5 accent-accent"
                  />
                  <span className="flex-1">{s.label}</span>
                  {s.hasQr && <span className="text-sm text-muted">déjà un QR code</span>}
                </label>
              );
            })}
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <button type="button" className={primaryButton} disabled={!file || !choice || status === "uploading"} onClick={() => void send()}>
          {status === "uploading" ? "Envoi…" : "Envoyer le QR code"}
        </button>
        {status === "error" && <p className={errorText}>Envoi impossible, réessayez.</p>}
      </div>
    </>
  );
}
