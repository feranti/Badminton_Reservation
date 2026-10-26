import type { Metadata } from "next";
import { SubPage } from "@/components/app-shell";
import { card, sectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Calcul des comptes · Badminton Résas" };

// Explique le calcul de la vue « balances » (supabase/migrations) et de simplifyDebts (src/lib/settle.ts).
export default function AccountsHelpPage() {
  return (
    <SubPage back="/comptes" title="Calcul des comptes">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Comment sont calculés les comptes ?</h1>
        <p className="text-muted">
          Celui qui réserve avance l&apos;argent, puis chaque joueur rembourse sa part. L&apos;appli fait les calculs à votre place.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>1. Le prix d&apos;une session</h2>
        <p>
          Le prix d&apos;une session est la somme de ses terrains. Il est partagé à parts égales entre les joueurs inscrits.
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
          <li>Les joueurs en liste d&apos;attente ne paient rien tant qu&apos;ils n&apos;ont pas de place.</li>
          <li>
            Un joueur peut venir avec des invités extérieurs (+1, +2…). Chaque invité prend une place et sa part est payée
            par le joueur qui l&apos;amène.
          </li>
          <li>Si quelqu&apos;un se désinscrit, la part des autres est recalculée tout de suite.</li>
          <li>Une session sans aucun joueur inscrit ne compte pas dans les comptes.</li>
          <li>Les sessions à venir comptent aussi : votre solde tient compte des inscriptions en cours.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>2. Ce que chacun a avancé</h2>
        <p>Le joueur qui a payé un terrain est crédité de son prix.</p>
        <p className="text-muted">
          Quand un terrain est partagé entre deux payeurs, chacun est crédité de la moitié.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>3. Votre solde</h2>
        <p>Votre solde, c&apos;est ce que vous avez avancé, moins vos parts, plus ou moins les remboursements.</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
          <li>
            <span className="text-accent-ink">Positif</span> : on vous doit de l&apos;argent.
          </li>
          <li>
            <span className="text-warn">Négatif</span> : vous devez de l&apos;argent.
          </li>
          <li>Un remboursement ne compte qu&apos;une fois confirmé par celui qui reçoit l&apos;argent.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Exemple</h2>
        <div className={`${card} flex flex-col gap-2 p-4 text-[15px]`}>
          <p>
            Julie réserve 2 terrains à 25 €, soit <strong className="font-semibold">50 €</strong>. Quatre joueurs
            s&apos;inscrivent : Julie, Karim, Léa et vous.
          </p>
          <p>
            Chacun doit <strong className="font-semibold">12,50 €</strong>. Julie a avancé 50 € et doit sa part de 12,50 € :
            son solde est de <span className="text-accent-ink">+37,50 €</span>.
          </p>
          <p>
            Karim, Léa et vous avez un solde de <span className="text-warn">−12,50 €</span>, à rembourser à Julie.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>4. Qui rembourse qui</h2>
        <p>
          Pour limiter le nombre de virements, l&apos;appli ne suit pas chaque session une par une : elle part des soldes de
          chacun.
        </p>
        <p className="text-muted">
          Celui qui doit le plus rembourse celui à qui on doit le plus, et ainsi de suite jusqu&apos;à ce que tout le monde soit
          à jour. Vous pouvez donc avoir à rembourser quelqu&apos;un qui n&apos;a pas réservé vos sessions : le résultat est
          le même pour tout le monde.
        </p>
        <p className="text-muted">Les écarts d&apos;un centime dus aux arrondis sont ignorés.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>5. Rembourser</h2>
        <p>
          Après avoir payé (virement, Lydia, espèces…), appuyez sur « C&apos;est fait » dans Comptes. Le joueur qui reçoit
          l&apos;argent confirme, et les soldes se mettent à jour.
        </p>
        <p className="text-muted">
          Si c&apos;est vous qui recevez l&apos;argent, « J&apos;ai reçu » l&apos;enregistre directement, sans confirmation.
        </p>
      </section>
    </SubPage>
  );
}
