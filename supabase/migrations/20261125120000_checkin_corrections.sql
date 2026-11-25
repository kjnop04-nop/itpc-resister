alter table public.checkins
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.staff_accounts (id) on delete set null,
  add column if not exists voided_by_label text,
  add column if not exists void_reason text;

alter table public.checkins
  drop constraint if exists checkins_registration_id_key;

create unique index if not exists checkins_one_active_registration
  on public.checkins (registration_id)
  where voided_at is null;

create index if not exists checkins_active_checked_in_at
  on public.checkins (checked_in_at desc)
  where voided_at is null;

create or replace function public.list_active_checkins(
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
  staff_label text
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
    c.staff_label
  from public.checkins as c
  join public.registrations as r on r.id = c.registration_id
  where c.voided_at is null
    and (
      coalesce(trim(p_search), '') = ''
      or concat_ws(' ', r.application_code, r.title, r.first_name, r.last_name)
        ilike '%' || trim(p_search) || '%'
    )
  order by c.checked_in_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_active_checkins(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_active_checkins(text, integer, integer)
  to service_role;

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
  from public.staff_accounts
  where id = p_actor_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Active staff access required';
  end if;

  update public.checkins
  set voided_at = now(),
      voided_by = p_actor_id,
      voided_by_label = actor_label,
      void_reason = trim(p_reason)
  where id = p_checkin_id and voided_at is null;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.void_checkin(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.void_checkin(uuid, uuid, text)
  to service_role;
