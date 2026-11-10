import { formatTime } from "@/lib/format";
import { dayLabel, describeEvent, type HistoryEvent, type Tone, whenLabel } from "@/lib/history";

const tones: Record<Tone, string> = {
  green: "bg-accent-tint border-accent/30",
  red: "bg-danger/15 border-danger/25",
  yellow: "bg-warn-bg border-warn/30",
  neutral: "bg-chip border-line",
};

// Chronologie des événements d'une session, du plus récent au plus ancien.
// grouped : un titre par jour (page Historique) ; sinon le jour est sur chaque ligne.
export function SessionHistory({
  events,
  names,
  grouped = false,
}: {
  events: HistoryEvent[];
  names: Map<string, string>;
  grouped?: boolean;
}) {
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "Quelqu'un") : "Quelqu'un");
  const now = new Date();
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const line = describeEvent(e, nameOf);
        const day = dayLabel(e.created_at, now);
        const newDay = grouped && (i === 0 || dayLabel(events[i - 1].created_at, now) !== day);
        const last = i === events.length - 1 || (grouped && dayLabel(events[i + 1].created_at, now) !== day);
        const when = grouped ? formatTime(e.created_at) : whenLabel(e.created_at, now);
        return (
          <li key={e.id} className="flex flex-col">
            {newDay && <h3 className={`text-[13px] font-semibold tracking-wider text-muted uppercase ${i ? "mt-2" : ""} mb-2`}>{day}</h3>}
            <div className="relative flex gap-3 pb-4">
              {!last && <span aria-hidden className="absolute top-9 bottom-0 left-[17px] w-px bg-line" />}
              <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-base ${tones[line.tone]}`}>
                {line.icon}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-1.5">
                <p className="text-[15px] leading-snug">
                  {line.parts.map((p, j) => (typeof p === "string" ? p : <b key={j} className="font-semibold">{p.name}</b>))}
                </p>
                <p className="text-[13px] text-faint">{[when, ...line.detail].join(" · ")}</p>
                {line.changes.map((c) => (
                  <span key={c} className="mt-1 self-start rounded-lg bg-chip px-2 py-1 text-[13px] text-muted">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
