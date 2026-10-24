import { addParticipant, removeParticipant } from "@/app/sessions/actions";
import type { Player, Session } from "@/lib/data";
import { primaryButton, secondaryButton } from "./ui";

function Chip({ name, me }: { name: string; me: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-sm ${
        me ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" : "bg-zinc-100 dark:bg-zinc-800"
      }`}
    >
      {name}
    </span>
  );
}

// Joueurs inscrits, liste d'attente et bouton d'inscription d'une session.
export function SessionPlayers({
  session,
  players,
  userId,
  canJoin,
}: {
  session: Session;
  players: Map<string, Player>;
  userId: string;
  canJoin: boolean;
}) {
  const s = session;
  const name = (id: string) => players.get(id)?.display_name ?? "?";
  const playing = s.players.filter((p) => p.is_playing);
  const waiting = s.players.filter((p) => !p.is_playing);
  const me = s.players.find((p) => p.player_id === userId);
  const full = playing.length >= s.capacity;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">
          {playing.length}/{s.capacity} joueurs :
        </span>
        {playing.map((p) => (
          <Chip key={p.player_id} name={name(p.player_id)} me={p.player_id === userId} />
        ))}
      </div>
      {waiting.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">Liste d&apos;attente :</span>
          {waiting.map((p) => (
            <Chip key={p.player_id} name={name(p.player_id)} me={p.player_id === userId} />
          ))}
        </div>
      )}
      {me && !me.is_playing && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Vous êtes n°{me.position - s.capacity} sur la liste d&apos;attente. Vous recevrez un e-mail si une place se libère.
        </p>
      )}
      {canJoin && (
        <form
          action={me ? removeParticipant.bind(null, s.id, userId) : addParticipant.bind(null, s.id, userId)}
        >
          <button type="submit" className={me ? secondaryButton : primaryButton}>
            {me ? "Me désinscrire" : full ? "M'inscrire en liste d'attente" : "Je m'inscris"}
          </button>
        </form>
      )}
    </div>
  );
}
