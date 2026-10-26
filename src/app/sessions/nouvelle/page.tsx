import { Suspense } from "react";
import { Loading, SubPage } from "@/components/app-shell";
import { NewBookingForm } from "@/components/new-booking-form";
import { USUAL_WEEKDAYS } from "@/lib/courts";
import { getLastDefaults, getPlayers } from "@/lib/data";
import { formatPriceInput, nextDates } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function NewBookingPage() {
  return (
    <SubPage back="/" close title="Nouvelle réservation" withFooter>
      <Suspense fallback={<Loading />}>
        <Form />
      </Suspense>
    </SubPage>
  );
}

async function Form() {
  const { userId } = await requirePlayer();
  const [players, defaults] = await Promise.all([getPlayers(), getLastDefaults()]);
  return (
    <NewBookingForm
      players={players}
      userId={userId}
      dates={nextDates(USUAL_WEEKDAYS, 3)}
      defaultVenue={defaults.venue}
      defaultPrice={defaults.priceCents === null ? "" : formatPriceInput(defaults.priceCents)}
    />
  );
}
