"use client";

import { useRef } from "react";
import { CloseIcon } from "./icons";

// Bouton qui affiche un QR code dans une fenêtre par-dessus la page.
// Fermeture : la croix, un clic en dehors de l'image, ou Échap (géré par <dialog>).
export function QrViewer({
  url,
  path,
  title,
  className,
  children,
}: {
  url: string;
  path: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pdf = path.toLowerCase().endsWith(".pdf");

  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>
        {children}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl bg-surface p-0 text-ink backdrop:bg-black/60"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-4">
          <p className="text-[15px] font-semibold">{title}</p>
          <button
            type="button"
            aria-label="Fermer"
            className="flex size-11 items-center justify-center text-muted hover:text-ink"
            onClick={() => ref.current?.close()}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="px-4 pb-4">
          {pdf ? (
            <iframe src={url} title={title} className="h-[70vh] w-full rounded-lg bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={title} className="max-h-[75vh] w-full rounded-lg bg-white object-contain" />
          )}
        </div>
      </dialog>
    </>
  );
}
