-- Les joueurs n'écrivent plus que les colonnes dont l'appli se sert.
--
-- Avant, l'API acceptait presque toutes les colonnes à l'ajout et à la modification. En
-- l'appelant directement, un joueur pouvait :
--   - réécrire l'auteur d'une annulation (cancelled_by, left_by, removed_by), par exemple pour
--     afficher « Session annulée par Alice » alors que c'est Bob qui l'a annulée ;
--   - créer une ligne déjà annulée « par » quelqu'un d'autre, antidater une création
--     (created_at) ou marquer le rappel WhatsApp comme déjà envoyé (reminder_sent_at) ;
--   - se déclarer créateur de la session d'un autre (created_by) pour pouvoir l'annuler.
-- Désormais, les colonnes « annulé par » ne sont remplies que par la base (stamp_cancellation,
-- 0008), et les dates, créateurs et liens de fusion que par la base ou ses fonctions.
-- Les sessions et les terrains sont créés et retirés par add_court_booking et
-- remove_court_booking (security definer), qui ne dépendent pas de ces droits.

-- Sessions : seuls le gymnase, la note et l'annulation (par le créateur, règle RLS) changent.
revoke insert, update on public.sessions from authenticated;
grant update (venue, notes, cancelled_at) on public.sessions to authenticated;

-- Terrains : prix et payeurs. L'ajout et le retrait passent par les fonctions.
revoke insert, update on public.court_bookings from authenticated;
grant update (price_cents, card_pricing, booked_by, co_payer, booked_by_card, co_payer_card)
  on public.court_bookings to authenticated;

-- Inscriptions : par add_participants (qui s'exécute avec les droits du joueur) ; ensuite,
-- invités et désinscription.
revoke insert, update on public.session_participants from authenticated;
grant insert (session_id, player_id, guests) on public.session_participants to authenticated;
grant update (guests, left_at) on public.session_participants to authenticated;

-- Remboursements : l'auteur (created_by) et la date sont remplis par la base ; l'annulation
-- passe par cancel_payment, la confirmation par le bénéficiaire (règle RLS).
revoke insert, update on public.payments from authenticated;
grant insert (from_player, to_player, amount_cents, note, confirmed_at) on public.payments to authenticated;
grant update (confirmed_at) on public.payments to authenticated;

-- QR codes : ajout ou remplacement (upsert) et retrait, sans l'auteur ni la date.
revoke insert, update on public.booking_qr_codes from authenticated;
grant insert (booking_id, hour, qr_path, removed_at) on public.booking_qr_codes to authenticated;
grant update (booking_id, hour, qr_path, removed_at) on public.booking_qr_codes to authenticated;

-- Un QR code ajouté directement comme retiré a aussi son auteur rempli par la base.
create trigger stamp_cancellation_insert before insert on public.booking_qr_codes
  for each row execute function public.stamp_cancellation('removed_at', 'removed_by');
