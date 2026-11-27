-- ==============================================================================
-- RLS Policies สำหรับ anon role (ไม่ต้อง Disable RLS และไม่ต้องใช้ JWT Secret)
-- ==============================================================================

-- 1. สร้างตาราง staff_login_attempts หากยังไม่มีในระบบ
create table if not exists public.itpc_register_staff_login_attempts (
  staff_id uuid primary key references public.itpc_register_staff_accounts (id) on delete cascade,
  failure_count integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz not null default now()
);

-- 2. ให้สิทธิ์ schema public และ sequences แก่ anon
grant usage on schema public to anon;
grant usage, select on all sequences in schema public to anon;
grant execute on all functions in schema public to anon;
grant execute on all routines in schema public to anon;

-- 3. ให้สิทธิ์ table operations แก่ anon
-- (สำหรับ staff_accounts ให้เข้าถึงเฉพาะคอลัมน์ทั่วไป ห้ามแตะ password_hash เพื่อความปลอดภัย)
grant select (
  id,
  login_id,
  email,
  display_name,
  role,
  status,
  created_at,
  last_login_at
) on table public.itpc_register_staff_accounts to anon;

grant select, insert, update, delete on table public.itpc_register_registrations to anon;
grant select, insert, update, delete on table public.itpc_register_checkins to anon;
grant select, insert, update, delete on table public.itpc_register_academic_year_settings to anon;
grant select, insert, update, delete on table public.itpc_register_staff_login_attempts to anon;

-- 4. เปิดการใช้งาน Row Level Security (RLS) ไว้ทุกตาราง
alter table public.itpc_register_staff_accounts enable row level security;
alter table public.itpc_register_registrations enable row level security;
alter table public.itpc_register_checkins enable row level security;
alter table public.itpc_register_academic_year_settings enable row level security;
alter table public.itpc_register_staff_login_attempts enable row level security;

-- 5. สร้าง RLS Policies สำหรับ anon role
drop policy if exists "anon_select_staff_accounts" on public.itpc_register_staff_accounts;
create policy "anon_select_staff_accounts"
  on public.itpc_register_staff_accounts
  for select
  to anon
  using (true);

drop policy if exists "anon_manage_registrations" on public.itpc_register_registrations;
create policy "anon_manage_registrations"
  on public.itpc_register_registrations
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon_manage_checkins" on public.itpc_register_checkins;
create policy "anon_manage_checkins"
  on public.itpc_register_checkins
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon_manage_academic_year_settings" on public.itpc_register_academic_year_settings;
create policy "anon_manage_academic_year_settings"
  on public.itpc_register_academic_year_settings
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon_manage_staff_login_attempts" on public.itpc_register_staff_login_attempts;
create policy "anon_manage_staff_login_attempts"
  on public.itpc_register_staff_login_attempts
  for all
  to anon
  using (true)
  with check (true);

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
