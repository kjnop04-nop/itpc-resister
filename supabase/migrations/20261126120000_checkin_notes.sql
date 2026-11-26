alter table public.checkins
  add column if not exists note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checkins_note_length'
      and conrelid = 'public.checkins'::regclass
  ) then
    alter table public.checkins
      add constraint checkins_note_length
        check (note is null or char_length(note) <= 500);
  end if;
end;
$$;

drop function if exists public.list_active_checkins(text, integer, integer);

create function public.list_active_checkins(
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
  note text
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
    c.note
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
