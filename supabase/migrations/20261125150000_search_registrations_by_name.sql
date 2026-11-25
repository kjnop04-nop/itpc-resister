create or replace function public.search_registrations(
  p_query text,
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
  where s.term <> ''
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

revoke all on function public.search_registrations(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_registrations(text, integer)
  to service_role;
