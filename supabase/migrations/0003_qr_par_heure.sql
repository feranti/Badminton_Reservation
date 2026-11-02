-- Un QR code par heure de terrain : l'UCPA en donne un pour chaque heure réservée
-- (un terrain de 20:00 à 22:00 a donc deux QR codes : 20:00 – 21:00 et 21:00 – 22:00).
-- hour = rang de l'heure dans la réservation, en partant de 0.
create table public.booking_qr_codes (
  booking_id uuid not null references public.court_bookings (id) on delete cascade,
  hour smallint not null check (hour between 0 and 23),
  qr_path text not null,                                    -- QR code dans le stockage « qr-codes »
  created_at timestamptz not null default now(),
  primary key (booking_id, hour),
  constraint booking_qr_codes_qr_path_length check (char_length(qr_path) <= 300)
);

-- Le QR code déjà saisi d'un terrain devient celui de sa première heure.
insert into public.booking_qr_codes (booking_id, hour, qr_path)
select id, 0, qr_path from public.court_bookings where qr_path is not null;

alter table public.court_bookings drop column qr_path;

alter table public.booking_qr_codes enable row level security;
create policy "qr: lecture" on public.booking_qr_codes
  for select to authenticated using (true);
create policy "qr: ajout" on public.booking_qr_codes
  for insert to authenticated with check (true);
create policy "qr: remplacement" on public.booking_qr_codes
  for update to authenticated using (true) with check (true);
create policy "qr: suppression" on public.booking_qr_codes
  for delete to authenticated using (true);

grant select, insert, update, delete on public.booking_qr_codes to authenticated;

alter publication supabase_realtime add table public.booking_qr_codes;
