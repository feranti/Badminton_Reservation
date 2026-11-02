import { Suspense } from "react";
import { Loading, SubPage } from "@/components/app-shell";
import { ShareQr, type QrSlot } from "@/components/share-qr";
import { groupByCourt } from "@/components/session-card";
import { bookingHours } from "@/lib/courts";
import { getSessions } from "@/lib/data";
import { formatDay, formatTimes } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

// Page ouverte par le menu « Partager » d'Android : on choisit la résa et l'heure
// à qui donner l'image du QR code reçue (voir public/sw.js).
export default function SharePage({ searchParams }: PageProps<"/partager">) {
  return (
    <SubPage back="/" close title="Partager un QR code">
      <Suspense fallback={<Loading />}>
        <Share searchParams={searchParams} />
      </Suspense>
    </SubPage>
  );
}

async function Share({ searchParams }: { searchParams: PageProps<"/partager">["searchParams"] }) {
  const failed = (await searchParams).erreur === "1";
  await requirePlayer();
  const sessions = await getSessions(false);
  const groups = sessions
    .map((s) => ({
      title: formatDay(s.starts_at),
      slots: groupByCourt(s.bookings).flatMap(([court, list]) =>
        list.flatMap((b) =>
          bookingHours(b).map(
            (h): QrSlot => ({
              sessionId: s.id,
              bookingId: b.id,
              hour: h.hour,
              label: `Terrain ${court} · ${formatTimes(h.startsAt, h.endsAt)}`,
              hasQr: b.qrs.some((q) => q.hour === h.hour),
            }),
          ),
        ),
      ),
    }))
    .filter((g) => g.slots.length > 0);
  return <ShareQr groups={groups} failed={failed} />;
}
