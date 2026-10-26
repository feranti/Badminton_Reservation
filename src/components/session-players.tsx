import { addParticipant, removeParticipant } from "@/app/sessions/actions";
import { ConfirmButton } from "./confirm-button";
import type { Player, Session } from "@/lib/data";
import { sessionStatus } from "./session-card";
import { primaryButton, secondaryButton } from "./ui";

function Chip({ name, me }: { name: string; me: boolean }) {
  return (
    <li className={`rounded-full px-3.5 py-2 text-[15px] ${me ? "bg-accent-tint font-medium text-accent-ink" : "bg-chip"}`}>
      {name}
    </li>
  );
}

// Joueurs inscrits et liste d'attente d'une session, en pastilles.
export function SessionPlayers({ session: s, players, userId }: { session: Session; players: Map<string, Player>; userId: string }) {
  const name = (id: string) => players.get(id)?.display_name ?? "?";
  const playing = s.players.filter((p) => p.is_playing);
  const waiting = s.players.filter((p) => !p.is_playing);
  const free = Math.max(s.capacity - playing.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label="Joueurs inscrits">
        {playing.map((p) => (
          <Chip key={p.player_id} name={name(p.player_id)} me={p.player_id === userId} />
        ))}
        {free > 0 && (
          <li className="rounded-full border border-dashed border-dash px-3.5 py-2 text-[15px] text-muted">
            {free} place{free > 1 ? "s" : ""} libre{free > 1 ? "s" : ""}
          </li>
        )}
      </ul>
      {waiting.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Liste d&apos;attente</span>
          <ul className="flex flex-wrap gap-2" aria-label="Liste d'attente">
            {waiting.map((p) => (
              <Chip key={p.player_id} name={name(p.player_id)} me={p.player_id === userId} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Bouton principal de la session : s'inscrire, se mettre en attente ou se désinscrire.
export function JoinButton({ session: s, userId }: { session: Session; userId: string }) {
  const status = sessionStatus(s, userId);
  return (
    <>
      {status.me === "waiting" && (
        <p className="text-center text-sm text-warn">
          Vous êtes n°{status.rank} sur la liste d&apos;attente. Un e-mail vous préviendra si une place se libère.
        </p>
      )}
      {status.me ? (
        <form action={removeParticipant.bind(null, s.id, userId)}>
          <ConfirmButton message={leaveMessage(s, status.me)} className={`${secondaryButton} min-h-13 w-full text-base`}>
            Me désinscrire
          </ConfirmButton>
        </form>
      ) : (
        <form action={addParticipant.bind(null, s.id, userId)}>
          <button type="submit" className={`${primaryButton} min-h-13 w-full text-base`}>
            {status.free > 0 ? "Je m'inscris" : "M'inscrire en liste d'attente"}
          </button>
        </form>
      )}
    </>
  );
}

// Texte de la confirmation avant de se désinscrire.
function leaveMessage(s: Session, me: "playing" | "waiting") {
  if (me === "waiting") return "Quitter la liste d'attente de cette session ?";
  const waiting = s.players.some((p) => !p.is_playing);
  return waiting
    ? "Vous désinscrire de cette session ? Votre place ira au premier de la liste d'attente."
    : "Vous désinscrire de cette session ? La part des autres joueurs sera recalculée.";
}
