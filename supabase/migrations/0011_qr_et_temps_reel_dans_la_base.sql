-- QR codes et temps réel sans les services de Supabase (Storage et Realtime), pour pouvoir
-- ensuite déplacer la base sur le VPS : tout passe par Postgres.

-- 1. Images des QR codes, dans la base au lieu du stockage « qr-codes ».
--    path reprend le chemin enregistré dans booking_qr_codes.qr_path. Les images déjà envoyées
--    dans le stockage y sont recopiées par le serveur la première fois qu'on les affiche.
--    Mêmes limites que l'ancien stockage : 10 Mo, PNG, JPEG, WebP, HEIC/HEIF ou PDF.
create table public.qr_images (
  path text primary key check (char_length(path) <= 300),
  content_type text not null
    check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  data bytea not null check (octet_length(data) between 1 and 10485760),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.qr_images enable row level security;
create policy "qr_images: lecture" on public.qr_images
  for select to authenticated using (true);
-- Un joueur n'ajoute une image qu'en son nom ; ni modification ni suppression (comme les QR
-- codes retirés, l'image reste).
create policy "qr_images: ajout" on public.qr_images
  for insert to authenticated with check (created_by = (select auth.uid()));

revoke all on public.qr_images from anon, authenticated;
grant select, insert on public.qr_images to authenticated;

-- 2. Temps réel : chaque modification des tables affichées prévient le serveur (LISTEN
--    changements), qui demande aux pages ouvertes de se recharger. Seul le nom de la table part,
--    jamais les données.
create function public.signaler_changement() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  perform pg_notify('changements', tg_table_name);
  return null;
end;
$$;
revoke execute on function public.signaler_changement() from public, anon, authenticated;

create trigger signaler_changement after insert or update or delete on public.sessions
  for each statement execute function public.signaler_changement();
create trigger signaler_changement after insert or update or delete on public.court_bookings
  for each statement execute function public.signaler_changement();
create trigger signaler_changement after insert or update or delete on public.booking_qr_codes
  for each statement execute function public.signaler_changement();
create trigger signaler_changement after insert or update or delete on public.session_participants
  for each statement execute function public.signaler_changement();
create trigger signaler_changement after insert or update or delete on public.payments
  for each statement execute function public.signaler_changement();
