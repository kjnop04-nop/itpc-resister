create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  application_code text not null unique
    check (application_code ~ '^[A-Z0-9]+$'),
  application_year text not null,
  title text not null,
  first_name text not null,
  last_name text not null,
  group_number smallint not null
    check (group_number between 1 and 30),
  slot_text text not null,
  slot_start time without time zone not null,
  slot_end time without time zone not null,
  created_at timestamptz not null default now(),
  constraint registrations_slot_order check (slot_start < slot_end)
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique
    references public.registrations (id) on delete restrict,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid not null
    references auth.users (id) on delete restrict,
  staff_label text not null,
  photo_path text not null,
  constraint checkins_photo_path_matches_staff
    check (split_part(photo_path, '/', 1) = checked_in_by::text)
);

alter table public.registrations enable row level security;
alter table public.checkins enable row level security;

revoke all on table public.registrations from public, anon, authenticated;
revoke all on table public.checkins from public, anon, authenticated;
grant select on table public.registrations to authenticated;
grant select, insert on table public.checkins to authenticated;

drop policy if exists "Authenticated staff can read registrations" on public.registrations;
create policy "Authenticated staff can read registrations"
  on public.registrations
  for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated staff can read check-ins" on public.checkins;
create policy "Authenticated staff can read check-ins"
  on public.checkins
  for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Staff can create their own check-ins" on public.checkins;
create policy "Staff can create their own check-ins"
  on public.checkins
  for insert
  to authenticated
  with check (checked_in_by = (select auth.uid()));

create or replace function public.set_checkin_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  new.checked_in_by := auth.uid();
  new.staff_label := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  return new;
end;
$$;

drop trigger if exists set_checkin_staff on public.checkins;
create trigger set_checkin_staff
  before insert on public.checkins
  for each row
  execute function public.set_checkin_staff();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkin-photos', 'checkin-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg'];

drop policy if exists "Staff can upload own check-in photos" on storage.objects;
create policy "Staff can upload own check-in photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Staff can read own check-in photos" on storage.objects;
create policy "Staff can read own check-in photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Staff can remove own check-in photos" on storage.objects;
create policy "Staff can remove own check-in photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
