-- ==============================================================================
-- แก้ไขสำหรับระบบ Custom Table Auth (ไม่ใช้ Supabase Auth / auth.uid())
-- ปลอดภัย 100%: ป้องกัน Error หากตารางเดิมถูกเปลี่ยนชื่อไปแล้ว
-- ==============================================================================

-- 1. ลบ Trigger เก่าที่ผูกกับ Supabase Auth ออกอย่างปลอดภัย (ตรวจเช็คการมีอยู่ของตารางก่อนลบ)
do $$
begin
  if to_regclass('public.itpc_register_checkins') is not null then
    drop trigger if exists set_checkin_staff on public.itpc_register_checkins;
    alter table public.itpc_register_checkins
      drop constraint if exists checkins_checked_in_by_fkey,
      drop constraint if exists itpc_register_checkins_checked_in_by_fkey;
  end if;

end;
$$;

drop function if exists public.set_checkin_staff();

-- 2. สร้างตาราง staff_login_attempts หากยังไม่มีในระบบ
create table if not exists public.itpc_register_staff_login_attempts (
  staff_id uuid primary key references public.itpc_register_staff_accounts (id) on delete cascade,
  failure_count integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz not null default now()
);

-- 3. ให้สิทธิ์ schema public และทุกตารางแก่ anon role
grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon;
grant execute on all functions in schema public to anon;
grant execute on all routines in schema public to anon;

alter default privileges in schema public grant select, insert, update, delete on tables to anon;
alter default privileges in schema public grant usage, select on sequences to anon;
alter default privileges in schema public grant execute on routines to anon;

-- 4. ปิด RLS เพื่อไม่ให้บล็อกคำขอ (การตรวจสอบสิทธิ์และเซสชันทำที่ Node.js Server แล้ว)
alter table if exists public.itpc_register_staff_accounts disable row level security;
alter table if exists public.itpc_register_registrations disable row level security;
alter table if exists public.itpc_register_checkins disable row level security;
alter table if exists public.itpc_register_academic_year_settings disable row level security;
alter table if exists public.itpc_register_staff_login_attempts disable row level security;

-- 5. ปรับปรุงฟังก์ชัน void_checkin ให้ตรวจสอบ p_actor_id จากตาราง itpc_register_staff_accounts (ไม่ใช้ auth.uid())
create or replace function public.void_checkin(
  p_actor_id uuid,
  p_checkin_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_label text;
  affected_rows integer;
begin
  if length(trim(coalesce(p_reason, ''))) < 3
    or length(trim(p_reason)) > 300 then
    raise exception using errcode = '22023', message = 'A correction reason is required';
  end if;

  select coalesce(display_name, email) into actor_label
  from public.itpc_register_staff_accounts
  where id = p_actor_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Active staff access required';
  end if;

  update public.itpc_register_checkins
  set voided_at = pg_catalog.now(),
      voided_by = p_actor_id,
      voided_by_label = actor_label,
      void_reason = trim(p_reason)
  where id = p_checkin_id and voided_at is null;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

grant execute on function public.void_checkin(uuid, uuid, text) to anon;

-- 6. Storage Policies สำหรับรูปถ่าย checkin-photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkin-photos', 'checkin-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg'];

grant select, insert, update, delete on table storage.objects to anon;

drop policy if exists "Anon can upload check-in photos" on storage.objects;
create policy "Anon can upload check-in photos"
  on storage.objects for insert to anon
  with check (bucket_id = 'checkin-photos');

drop policy if exists "Anon can read check-in photos" on storage.objects;
create policy "Anon can read check-in photos"
  on storage.objects for select to anon
  using (bucket_id = 'checkin-photos');

drop policy if exists "Anon can remove check-in photos" on storage.objects;
create policy "Anon can remove check-in photos"
  on storage.objects for delete to anon
  using (bucket_id = 'checkin-photos');
