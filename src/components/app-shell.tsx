import Link from "next/link";
import { BackIcon, CalendarIcon, CloseIcon, PlusIcon, UserIcon, WalletIcon } from "./icons";
import { UcpaMenu } from "./ucpa-menu";

const roundButton = "flex size-11 items-center justify-center rounded-full";

// Page principale (Sessions ou Comptes) : titre, raccourcis en haut, onglets en bas.
export function TabPage({
  title,
  tab,
  children,
}: {
  title: string;
  tab: "sessions" | "comptes";
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="mx-auto flex w-full max-w-xl items-center justify-between px-5 pt-5 pb-2">
        <span className="text-[17px] font-semibold tracking-tight">{title}</span>
        <div className="flex items-center gap-2">
          {tab === "sessions" && <UcpaMenu />}
          {tab === "sessions" && (
            <Link href="/sessions/nouvelle" aria-label="Nouvelle réservation" className={`${roundButton} bg-accent text-on-accent`}>
              <PlusIcon />
            </Link>
          )}
          <Link href="/profil" aria-label="Mon profil" className={`${roundButton} bg-line text-ink`}>
            <UserIcon />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 pt-2 pb-28">{children}</main>
      <TabBar active={tab} />
    </>
  );
}

function TabBar({ active }: { active: "sessions" | "comptes" }) {
  const item = (on: boolean) =>
    `flex flex-col items-center gap-1 py-2 text-xs ${on ? "font-semibold text-ink" : "font-medium text-faint"}`;
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[max(env(safe-area-inset-bottom),12px)]"
    >
      <div className="mx-auto grid max-w-xl grid-cols-2 pt-1">
        <Link href="/" aria-current={active === "sessions" ? "page" : undefined} className={item(active === "sessions")}>
          <CalendarIcon />
          Sessions
        </Link>
        <Link href="/comptes" aria-current={active === "comptes" ? "page" : undefined} className={item(active === "comptes")}>
          <WalletIcon />
          Comptes
        </Link>
      </div>
    </nav>
  );
}

// Page secondaire : bouton retour (ou fermer), titre facultatif, action à droite.
export function SubPage({
  back,
  close = false,
  title,
  right,
  withFooter = false,
  children,
}: {
  back: string;
  close?: boolean;
  title?: React.ReactNode;
  right?: React.ReactNode;
  withFooter?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="mx-auto grid w-full max-w-xl grid-cols-[44px_1fr_auto] items-center gap-2 px-2 pt-3">
        <Link href={back} aria-label={close ? "Fermer" : "Retour"} className={`${roundButton} text-ink`}>
          {close ? <CloseIcon /> : <BackIcon />}
        </Link>
        <span className="truncate text-center text-base font-semibold">{title}</span>
        <div className="flex min-w-11 justify-end">{right}</div>
      </header>
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-7 px-5 pt-3 ${withFooter ? "pb-32" : "pb-10"}`}>
        {children}
      </main>
    </>
  );
}

// Bouton principal collé en bas de l'écran (à utiliser avec withFooter sur SubPage).
export function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg pb-[max(env(safe-area-inset-bottom),16px)]">
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-5 pt-4">{children}</div>
    </div>
  );
}

// Écran de chargement : des formes grises qui imitent la page et pulsent doucement.
// « list » : une carte puis des lignes (accueil, comptes, session). « form » : des champs.
// « alone » : la page entière charge, sans en-tête autour, donc on laisse la place du bouton retour.
export function Loading({ variant = "list", alone = false }: { variant?: "list" | "form"; alone?: boolean }) {
  const bar = (className: string) => <div className={`rounded-md bg-line ${className}`} />;
  return (
    <div
      role="status"
      aria-label="Chargement"
      className={`flex flex-col gap-6 motion-safe:animate-pulse ${alone ? "mx-auto w-full max-w-xl px-5 pt-[68px]" : ""}`}
    >
      <span className="sr-only">Chargement…</span>
      {variant === "form" ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            {bar("h-3.5 w-24")}
            <div className="h-12 rounded-xl border border-line bg-surface" />
          </div>
        ))
      ) : (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-2">
                {bar("h-7 w-40")}
                {bar("h-4 w-48")}
              </div>
              {bar("h-7 w-16 rounded-full")}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                {bar("h-3.5 w-28")}
                {bar("h-3.5 w-20")}
              </div>
              {bar("h-1.5 rounded-full")}
            </div>
          </div>
          <div className="flex flex-col">
            {["w-32", "w-36", "w-28"].map((w) => (
              <div key={w} className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2">
                <div className="flex flex-col gap-1.5">
                  {bar(`h-4 ${w}`)}
                  {bar("h-3.5 w-44")}
                </div>
                {bar("h-3.5 w-14")}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
