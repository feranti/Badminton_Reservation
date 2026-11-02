"use client";

import { useEffect, useRef, useState } from "react";
import { UCPA_LINKS } from "@/lib/courts";
import { ExternalIcon } from "./icons";

// Pastille « UCPA » de l'en-tête : ouvre un petit menu vers le site de réservation et la carte 10 sessions.
export function UcpaMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
        className="flex h-11 items-center gap-1 rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-accent"
      >
        UCPA
        <ExternalIcon />
      </button>
      {open && (
        <ul aria-label="Liens UCPA" className="absolute top-13 right-0 z-20 w-60 overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
          {UCPA_LINKS.map((l) => (
            <li key={l.href} className="border-b border-line last:border-0">
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center justify-between gap-3 px-4 text-[15px] text-ink"
              >
                {l.label}
                <ExternalIcon className="size-4 text-accent" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
