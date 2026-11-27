alter table public.registrations
  drop constraint if exists registrations_application_code_key;

alter table public.registrations
  drop constraint if exists registrations_application_year_code_key;

alter table public.registrations
  add constraint registrations_application_year_code_key
    unique (application_year, application_code);

create table if not exists public.academic_year_settings (
  application_year text primary key
    check (application_year ~ '^[1-9][0-9]{3}$'),
  is_active boolean not null default false,
  schedule jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_year_schedule_round_count
    check (
      case
        when jsonb_typeof(schedule) = 'array' then jsonb_array_length(schedule) = 5
        else false
      end
    )
);

create unique index if not exists academic_year_settings_one_active
  on public.academic_year_settings (is_active)
  where is_active;

alter table public.academic_year_settings enable row level security;
revoke all on table public.academic_year_settings from public, anon, authenticated;
grant all on table public.academic_year_settings to service_role;

do $$
declare
  default_schedule jsonb := '[
    {"registration_start":"08:00","registration_end":"08:20","activity_start":"08:30","activity_end":"09:00"},
    {"registration_start":"08:40","registration_end":"09:00","activity_start":"09:10","activity_end":"09:40"},
    {"registration_start":"09:20","registration_end":"09:40","activity_start":"09:50","activity_end":"10:20"},
    {"registration_start":"10:00","registration_end":"10:20","activity_start":"10:30","activity_end":"11:00"},
    {"registration_start":"10:40","registration_end":"11:00","activity_start":"11:10","activity_end":"11:40"}
  ]'::jsonb;
begin
  insert into public.academic_year_settings (application_year, schedule)
  select distinct r.application_year, default_schedule
  from public.registrations as r
  where r.application_year ~ '^[1-9][0-9]{3}$'
  on conflict (application_year) do nothing;

  insert into public.academic_year_settings (application_year, schedule)
  values ('2027', default_schedule)
  on conflict (application_year) do nothing;

  if not exists (
    select 1
    from public.academic_year_settings
    where is_active
  ) then
    update public.academic_year_settings
    set is_active = true
    where application_year = (
      select max(application_year)
      from public.academic_year_settings
    );
  end if;
end;
$$;

create or replace function public.save_academic_year_settings(
  p_application_year text,
  p_schedule jsonb,
  p_activate boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_data jsonb;
  previous_activity_end time without time zone;
  registration_start time without time zone;
  registration_end time without time zone;
  activity_start time without time zone;
  activity_end time without time zone;
  year_is_active boolean;
begin
  if p_application_year is null or p_application_year !~ '^[1-9][0-9]{3}$'
    or p_schedule is null
    or jsonb_typeof(p_schedule) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid academic year or schedule';
  end if;
  if jsonb_array_length(p_schedule) <> 5 then
    raise exception using errcode = '22023', message = 'Schedule must have five rounds';
  end if;

  for round_data in select value from jsonb_array_elements(p_schedule)
  loop
    if not (
      round_data ? 'registration_start'
      and round_data ? 'registration_end'
      and round_data ? 'activity_start'
      and round_data ? 'activity_end'
      and coalesce(round_data ->> 'registration_start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and coalesce(round_data ->> 'registration_end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and coalesce(round_data ->> 'activity_start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and coalesce(round_data ->> 'activity_end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ) then
      raise exception using errcode = '22023', message = 'Incomplete schedule round';
    end if;

    registration_start := (round_data ->> 'registration_start')::time;
    registration_end := (round_data ->> 'registration_end')::time;
    activity_start := (round_data ->> 'activity_start')::time;
    activity_end := (round_data ->> 'activity_end')::time;
    if registration_start >= registration_end
      or registration_end > activity_start
      or activity_start >= activity_end
      or (previous_activity_end is not null and previous_activity_end > registration_start) then
      raise exception using errcode = '22023', message = 'Schedule times overlap or are out of order';
    end if;
    previous_activity_end := activity_end;
  end loop;

  if p_activate then
    update public.academic_year_settings set is_active = false where is_active;
  end if;

  insert into public.academic_year_settings (application_year, is_active, schedule)
  values (p_application_year, p_activate, p_schedule)
  on conflict (application_year) do update
  set is_active = case when p_activate then true else academic_year_settings.is_active end,
      schedule = excluded.schedule,
      updated_at = now();

  select is_active into year_is_active
  from public.academic_year_settings
  where application_year = p_application_year;

  if year_is_active then
    update public.registrations as r
    set slot_text = replace(schedule_round.value ->> 'activity_start', ':', '.')
        || ' - '
        || replace(schedule_round.value ->> 'activity_end', ':', '.')
        || ' น.',
        slot_start = (schedule_round.value ->> 'activity_start')::time,
        slot_end = (schedule_round.value ->> 'activity_end')::time
    from jsonb_array_elements(p_schedule) with ordinality as schedule_round(value, round_number)
    where r.application_year = p_application_year
      and r.group_number between ((schedule_round.round_number - 1) * 6 + 1)
        and (schedule_round.round_number * 6);
  end if;
end;
$$;

revoke all on function public.save_academic_year_settings(text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.save_academic_year_settings(text, jsonb, boolean)
  to service_role;

drop function if exists public.search_registrations(text, integer);

create function public.search_registrations(
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
  slot_end time without time zone
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
    r.slot_end
  from public.registrations as r
  cross join search_term as s
  where r.application_year = p_application_year
    and s.term <> ''
    and (
      (s.code <> '' and r.application_code ilike '%' || s.code || '%')
      or concat_ws(' ', r.title, r.first_name, r.last_name) ilike '%' || s.term || '%'
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || s.term || '%'
      or r.first_name ilike '%' || s.term || '%'
      or r.last_name ilike '%' || s.term || '%'
    )
  order by
    case
      when s.code <> '' and r.application_code ilike s.code || '%' then 0
      else 1
    end,
    r.application_code
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
$$;

revoke all on function public.search_registrations(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_registrations(text, text, integer)
  to service_role;

drop function if exists public.list_active_checkins(text, integer, integer);

create function public.list_active_checkins(
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
    and r.application_year = p_application_year
    and (
      coalesce(trim(p_search), '') = ''
      or concat_ws(' ', r.application_code, r.title, r.first_name, r.last_name)
        ilike '%' || trim(p_search) || '%'
    )
  order by c.checked_in_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_active_checkins(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_active_checkins(text, text, integer, integer)
  to service_role;

create or replace function public.require_active_academic_year_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.registrations as r
    join public.academic_year_settings as y
      on y.application_year = r.application_year
     and y.is_active
    where r.id = new.registration_id
  ) then
    raise exception using errcode = '22023', message = 'Check-ins can only be created for the active academic year';
  end if;
  return new;
end;
$$;

drop trigger if exists require_active_academic_year_checkin on public.checkins;
create trigger require_active_academic_year_checkin
  before insert on public.checkins
  for each row
  execute function public.require_active_academic_year_checkin();
