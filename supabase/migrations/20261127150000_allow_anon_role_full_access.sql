-- ==============================================================================
-- สคริปต์เปิดสิทธิ์ให้ anon role ใช้งานได้ 100% (แบบปลอดภัยจาก error overload)
-- ==============================================================================

-- 1. ให้สิทธิ์ schema public ทั้งหมดแก่ anon (ครอบคลุมทั้งตาราง, ฟังก์ชัน และ sequence)
grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon;
grant execute on all functions in schema public to anon;
grant execute on all routines in schema public to anon;

-- 2. ปลดล็อก Row Level Security (RLS) ทุกตาราง
alter table if exists public.staff_accounts disable row level security;
alter table if exists public.registrations disable row level security;
alter table if exists public.checkins disable row level security;
alter table if exists public.academic_year_settings disable row level security;
alter table if exists public.staff_login_attempts disable row level security;

-- 3. ตั้งค่าสิทธิ์เริ่มต้นสำหรับออบเจกต์ในอนาคต
alter default privileges in schema public grant select, insert, update, delete on tables to anon;
alter default privileges in schema public grant usage, select on sequences to anon;
alter default privileges in schema public grant execute on routines to anon;

-- 4. ตั้งค่า Storage Bucket และสิทธิ์เข้าถึงรูปภาพสำหรับ anon
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
