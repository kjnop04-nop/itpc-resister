-- ==============================================================================
-- แก้ไขฟังก์ชัน list_active_checkins และ search_registrations
-- ให้แสดงรายชื่อผู้สมัครที่ลงทะเบียนแล้ว (ตัดเงื่อนไข auth.uid() ออก)
-- ==============================================================================

-- 1. ปรับฟังก์ชันตรวจสอบสิทธิ์ให้คืนค่า true (เนื่องจาก Server Node.js ตรวจสอบสิทธิ์ผ่าน Cookie เรียบร้อยแล้ว)
create or replace function public.requesting_staff_is_active()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select true;
$$;

create or replace function public.requesting_staff_is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select true;
$$;

grant execute on function public.requesting_staff_is_active() to anon;
grant execute on function public.requesting_staff_is_admin() to anon;

-- 2. อัปเดต list_active_checkins ให้ดึงรายชื่อผู้สมัครที่ลงทะเบียนแล้วได้ทันที
drop function if exists public.list_active_checkins(text, text, integer, integer);
create or replace function public.list_active_checkins(
  p_application_year text,
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  checkin_id uuid,
  registration_id uuid,
  application_code text,
  title text,
  first_name text,
  last_name text,
  group_number smallint,
  slot_text text,
  checked_in_at timestamptz,
  staff_label text,
  note text,
  nickname text,
  parent_phone text
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id,
    c.registration_id,
    r.application_code,
    r.title,
    r.first_name,
    r.last_name,
    r.group_number,
    r.slot_text,
    c.checked_in_at,
    c.staff_label,
    c.note,
    r.nickname,
    r.parent_phone
  from public.itpc_register_checkins as c
  join public.itpc_register_registrations as r on r.id = c.registration_id
  where c.voided_at is null
    and r.application_year = p_application_year
    and (
      coalesce(trim(p_search), '') = ''
      or concat_ws(
        ' ',
        r.application_code,
        r.title,
        r.first_name,
        r.last_name,
        r.nickname,
        r.parent_phone
      )
        ilike '%' || trim(p_search) || '%'
    )
  order by c.checked_in_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.list_active_checkins(text, text, integer, integer) to anon;

-- 3. อัปเดต search_registrations ให้ค้นหาผู้สมัครได้ถูกต้อง
drop function if exists public.search_registrations(text, text, integer);
create or replace function public.search_registrations(
  p_query text,
  p_application_year text,
  p_limit integer default 10
)
returns table (
  id uuid,
  application_code text,
  application_year text,
  title text,
  first_name text,
  last_name text,
  group_number smallint,
  slot_text text,
  slot_start time without time zone,
  slot_end time without time zone,
  nickname text,
  parent_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  with search_term as (
    select
      trim(coalesce(p_query, '')) as term,
      regexp_replace(upper(trim(coalesce(p_query, ''))), '[^A-Z0-9]', '', 'g') as code
  )
  select
    r.id,
    r.application_code,
    r.application_year,
    r.title,
    r.first_name,
    r.last_name,
    r.group_number,
    r.slot_text,
    r.slot_start,
    r.slot_end,
    r.nickname,
    r.parent_phone
  from public.itpc_register_registrations as r
  cross join search_term as s
  where r.application_year = p_application_year
    and s.term <> ''
    and (
      (s.code <> '' and r.application_code ilike '%' || s.code || '%')
      or concat_ws(' ', r.title, r.first_name, r.last_name, r.nickname)
        ilike '%' || s.term || '%'
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || s.term || '%'
      or r.first_name ilike '%' || s.term || '%'
      or r.last_name ilike '%' || s.term || '%'
      or coalesce(r.parent_phone, '') ilike '%' || s.term || '%'
    )
  order by
    case
      when s.code <> '' and r.application_code ilike s.code || '%' then 0
      else 1
    end,
    r.application_code
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
$$;

grant execute on function public.search_registrations(text, text, integer) to anon;
