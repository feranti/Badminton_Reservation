import { Suspense } from "react";
import { Loading, SubPage } from "@/components/app-shell";
import { NewBookingForm } from "@/components/new-booking-form";
import { USUAL_WEEKDAYS } from "@/lib/courts";
import { getLastVenue, getPlayers } from "@/lib/data";
import { nextDates } from "@/lib/format";
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
  const [players, venue] = await Promise.all([getPlayers(), getLastVenue()]);
  return (
    <NewBookingForm
      players={players}
      userId={userId}
      dates={nextDates(USUAL_WEEKDAYS, 3)}
      defaultVenue={venue}
    />
  );
}
