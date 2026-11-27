-- Remove the broad anon grants and restore the staff/admin RLS model.
revoke all privileges on all tables in schema public from public, anon;
revoke all privileges on all sequences in schema public from public, anon;
revoke execute on all routines in schema public from public, anon;

alter default privileges in schema public
  revoke all on tables from public, anon;
alter default privileges in schema public
  revoke all on sequences from public, anon;
alter default privileges in schema public
  revoke execute on routines from public, anon;

grant usage on schema public to anon, authenticated;
grant execute on function public.verify_staff_login(text, text) to anon;

alter table public.itpc_register_registrations enable row level security;
alter table public.itpc_register_checkins enable row level security;
alter table public.itpc_register_staff_accounts enable row level security;
alter table public.itpc_register_academic_year_settings enable row level security;

revoke all privileges on table public.itpc_register_registrations
  from authenticated;
revoke all privileges on table public.itpc_register_checkins
  from authenticated;
revoke all privileges on table public.itpc_register_staff_accounts
  from authenticated;
revoke all privileges on table public.itpc_register_academic_year_settings
  from authenticated;

grant select, insert, update
  on table public.itpc_register_registrations to authenticated;
grant select, insert
  on table public.itpc_register_checkins to authenticated;
grant select (
  id,
  login_id,
  email,
  display_name,
  role,
  status,
  created_at,
  last_login_at
)
  on table public.itpc_register_staff_accounts to authenticated;
grant select
  on table public.itpc_register_academic_year_settings to authenticated;

revoke all privileges on table storage.objects from public, anon;
grant select, insert, delete on table storage.objects to authenticated;

drop policy if exists "Anon can upload check-in photos" on storage.objects;
drop policy if exists "Anon can read check-in photos" on storage.objects;
drop policy if exists "Anon can remove check-in photos" on storage.objects;

create or replace function public.requesting_staff_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.itpc_register_staff_accounts
    where id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.requesting_staff_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.itpc_register_staff_accounts
    where id = auth.uid()
      and status = 'active'
      and role in ('admin', 'superadmin')
  );
$$;

revoke all on function public.requesting_staff_is_active()
  from public, anon, authenticated;
revoke all on function public.requesting_staff_is_admin()
  from public, anon, authenticated;
grant execute on function public.requesting_staff_is_active() to authenticated;
grant execute on function public.requesting_staff_is_admin() to authenticated;

drop policy if exists "Authenticated staff can read registrations"
  on public.itpc_register_registrations;
drop policy if exists "Active staff can read registrations"
  on public.itpc_register_registrations;
drop policy if exists "Admins can insert registrations"
  on public.itpc_register_registrations;
drop policy if exists "Admins can update registrations"
  on public.itpc_register_registrations;
create policy "Active staff can read registrations"
  on public.itpc_register_registrations for select to authenticated
  using (public.requesting_staff_is_active());
create policy "Admins can insert registrations"
  on public.itpc_register_registrations for insert to authenticated
  with check (public.requesting_staff_is_admin());
create policy "Admins can update registrations"
  on public.itpc_register_registrations for update to authenticated
  using (public.requesting_staff_is_admin())
  with check (public.requesting_staff_is_admin());

drop policy if exists "Authenticated staff can read check-ins"
  on public.itpc_register_checkins;
drop policy if exists "Staff can create their own check-ins"
  on public.itpc_register_checkins;
drop policy if exists "Active staff can read check-ins"
  on public.itpc_register_checkins;
drop policy if exists "Active staff can create their own check-ins"
  on public.itpc_register_checkins;
create policy "Active staff can read check-ins"
  on public.itpc_register_checkins for select to authenticated
  using (public.requesting_staff_is_active());
create policy "Active staff can create their own check-ins"
  on public.itpc_register_checkins for insert to authenticated
  with check (
    public.requesting_staff_is_active()
    and checked_in_by = (select auth.uid())
  );

drop policy if exists "Staff can read their own account"
  on public.itpc_register_staff_accounts;
drop policy if exists "Admins can read staff accounts"
  on public.itpc_register_staff_accounts;
create policy "Staff can read their own account"
  on public.itpc_register_staff_accounts for select to authenticated
  using (id = (select auth.uid()));
create policy "Admins can read staff accounts"
  on public.itpc_register_staff_accounts for select to authenticated
  using (public.requesting_staff_is_admin());

drop policy if exists "Active staff can read academic year settings"
  on public.itpc_register_academic_year_settings;
create policy "Active staff can read academic year settings"
  on public.itpc_register_academic_year_settings for select to authenticated
  using (public.requesting_staff_is_active());

create or replace function public.verify_staff_login(
  p_login_id text,
  p_password text
)
returns table (id uuid, email text, display_name text, role text, status text)
language sql
security definer
set search_path = ''
as $$
  select account.id, account.email, account.display_name, account.role, account.status
  from public.itpc_register_staff_accounts as account
  where p_login_id is not null
    and pg_catalog.char_length(p_login_id) <= 254
    and p_password is not null
    and pg_catalog.char_length(p_password) <= 1024
    and account.login_id = lower(trim(p_login_id))
    and account.password_hash = extensions.crypt(
      case account.password_hash_scheme
        when 'bcrypt-sha256' then pg_catalog.encode(
          extensions.digest('staff-password-v1:' || p_password, 'sha256'),
          'hex'
        )
        else p_password
      end,
      account.password_hash
    );
$$;

revoke all on function public.verify_staff_login(text, text)
  from public, anon, authenticated;
grant execute on function public.verify_staff_login(text, text) to anon;

drop table if exists public.itpc_register_staff_login_attempts;

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
  if not public.requesting_staff_is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
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
    update public.itpc_register_academic_year_settings
    set is_active = false where is_active;
  end if;

  insert into public.itpc_register_academic_year_settings (
    application_year, is_active, schedule
  )
  values (p_application_year, p_activate, p_schedule)
  on conflict (application_year) do update
  set is_active = case when p_activate then true
    else itpc_register_academic_year_settings.is_active end,
      schedule = excluded.schedule,
      updated_at = pg_catalog.now();

  select is_active into year_is_active
  from public.itpc_register_academic_year_settings
  where application_year = p_application_year;

  if year_is_active then
    update public.itpc_register_registrations as r
    set slot_text = replace(schedule_round.value ->> 'activity_start', ':', '.')
        || ' - '
        || replace(schedule_round.value ->> 'activity_end', ':', '.')
        || ' น.',
        slot_start = (schedule_round.value ->> 'activity_start')::time,
        slot_end = (schedule_round.value ->> 'activity_end')::time
    from jsonb_array_elements(p_schedule) with ordinality
      as schedule_round(value, round_number)
    where r.application_year = p_application_year
      and r.group_number between ((schedule_round.round_number - 1) * 6 + 1)
        and (schedule_round.round_number * 6);
  end if;
end;
$$;

revoke all on function public.save_academic_year_settings(text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.save_academic_year_settings(text, jsonb, boolean)
  to authenticated;

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
  where public.requesting_staff_is_active()
    and r.application_year = p_application_year
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

revoke all on function public.search_registrations(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_registrations(text, text, integer)
  to authenticated;

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
  where public.requesting_staff_is_active()
    and c.voided_at is null
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

revoke all on function public.list_active_checkins(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_active_checkins(text, text, integer, integer)
  to authenticated;

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
  if p_actor_id is distinct from auth.uid()
    or not public.requesting_staff_is_active() then
    raise exception using errcode = '42501', message = 'Active staff access required';
  end if;
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

revoke all on function public.void_checkin(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.void_checkin(uuid, uuid, text)
  to authenticated;

create or replace function public.manager_create_staff_account(
  p_actor_id uuid,
  p_login_id text,
  p_email text,
  p_display_name text,
  p_password text,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  normalized_id text;
  normalized_email text;
begin
  if p_actor_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Manager identity mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(847261903);
  select role into actor_role
  from public.itpc_register_staff_accounts
  where id = p_actor_id and status = 'active';
  if actor_role is null or actor_role not in ('superadmin', 'admin') then
    raise exception using errcode = '42501', message = 'System manager access required';
  end if;

  normalized_id := lower(trim(coalesce(p_login_id, '')));
  normalized_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if length(normalized_id) < 1
    or length(normalized_id) > 254
    or normalized_id ~ '[[:space:]]'
    or (normalized_email is not null and (
      normalized_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
      or length(normalized_email) > 254
    ))
    or p_display_name is null
    or length(trim(p_display_name)) < 1
    or length(trim(p_display_name)) > 100
    or p_password is null
    or length(p_password) = 0
    or p_role is null
    or p_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'Invalid account details';
  end if;

  insert into public.itpc_register_staff_accounts (
    login_id,
    email,
    display_name,
    password_hash,
    password_hash_scheme,
    role,
    status
  )
  values (
    normalized_id,
    normalized_email,
    trim(p_display_name),
    extensions.crypt(
      pg_catalog.encode(
        extensions.digest('staff-password-v1:' || p_password, 'sha256'),
        'hex'
      ),
      extensions.gen_salt('bf', 12)
    ),
    'bcrypt-sha256',
    p_role,
    'active'
  );
  return true;
end;
$$;

revoke all on function public.manager_create_staff_account(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.manager_create_staff_account(
  uuid, text, text, text, text, text
) to authenticated;

create or replace function public.admin_update_staff_account(
  p_actor_id uuid,
  p_target_id uuid,
  p_status text,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_role text;
  target_status text;
  active_admin_count integer;
begin
  if p_actor_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Manager identity mismatch';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(847261903);
  select role into actor_role
  from public.itpc_register_staff_accounts
  where id = p_actor_id and status = 'active';
  if actor_role is null or actor_role not in ('superadmin', 'admin') then
    raise exception using errcode = '42501', message = 'System manager access required';
  end if;
  if p_status is null or p_status not in ('pending', 'active', 'rejected', 'suspended')
    or p_role is null or p_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'Invalid member state';
  end if;

  select role, status into target_role, target_status
  from public.itpc_register_staff_accounts where id = p_target_id for update;
  if not found then
    return false;
  end if;
  if target_role = 'superadmin'
    or (actor_role = 'admin' and (target_role <> 'staff' or p_role <> 'staff'))
    or (actor_role = 'superadmin' and target_role not in ('admin', 'staff')) then
    raise exception using errcode = '42501', message = 'Insufficient permission for target account';
  end if;
  if p_actor_id = p_target_id and (p_status <> 'active' or p_role <> actor_role) then
    raise exception using errcode = '42501', message = 'Cannot remove your own administrator access';
  end if;
  if target_role = 'admin' and target_status = 'active'
    and (p_role <> 'admin' or p_status <> 'active') then
    select count(*) into active_admin_count
    from public.itpc_register_staff_accounts
    where role = 'admin' and status = 'active';
    if active_admin_count <= 1 then
      raise exception using errcode = '42501', message = 'Cannot remove the last active administrator';
    end if;
  end if;

  update public.itpc_register_staff_accounts
  set role = p_role, status = p_status
  where id = p_target_id;
  return true;
end;
$$;

revoke all on function public.admin_update_staff_account(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_staff_account(uuid, uuid, text, text)
  to authenticated;

create or replace function public.admin_delete_staff_account(
  p_actor_id uuid,
  p_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_role text;
  target_status text;
  active_admin_count integer;
begin
  if p_actor_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Manager identity mismatch';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(847261903);
  select role into actor_role
  from public.itpc_register_staff_accounts
  where id = p_actor_id and status = 'active';
  if actor_role is null or actor_role not in ('superadmin', 'admin') then
    raise exception using errcode = '42501', message = 'System manager access required';
  end if;
  if p_actor_id = p_target_id then
    raise exception using errcode = '42501', message = 'Cannot delete your own account';
  end if;

  select role, status into target_role, target_status
  from public.itpc_register_staff_accounts where id = p_target_id for update;
  if not found then
    return false;
  end if;
  if target_role = 'superadmin'
    or (actor_role = 'admin' and target_role <> 'staff')
    or (actor_role = 'superadmin' and target_role not in ('admin', 'staff')) then
    raise exception using errcode = '42501', message = 'Insufficient permission for target account';
  end if;
  if target_role = 'admin' and target_status = 'active' then
    select count(*) into active_admin_count
    from public.itpc_register_staff_accounts
    where role = 'admin' and status = 'active';
    if active_admin_count <= 1 then
      raise exception using errcode = '42501', message = 'Cannot delete the last active administrator';
    end if;
  end if;

  delete from public.itpc_register_staff_accounts where id = p_target_id;
  return true;
end;
$$;

revoke all on function public.admin_delete_staff_account(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_staff_account(uuid, uuid)
  to authenticated;

create or replace function public.set_checkin_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.requesting_staff_is_active() then
    raise exception 'Active staff access required';
  end if;

  new.checked_in_by := auth.uid();
  new.staff_label := coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
    auth.jwt() ->> 'email',
    auth.uid()::text
  );
  return new;
end;
$$;

drop trigger if exists set_checkin_staff on public.itpc_register_checkins;
create trigger set_checkin_staff
  before insert on public.itpc_register_checkins
  for each row
  execute function public.set_checkin_staff();

drop policy if exists "Staff can upload own check-in photos" on storage.objects;
drop policy if exists "Staff can read own check-in photos" on storage.objects;
drop policy if exists "Staff can remove own check-in photos" on storage.objects;
drop policy if exists "Active staff can upload own check-in photos" on storage.objects;
drop policy if exists "Active staff can read check-in photos" on storage.objects;
drop policy if exists "Active staff can remove own check-in photos" on storage.objects;
create policy "Active staff can upload own check-in photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and public.requesting_staff_is_active()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Active staff can read check-in photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'checkin-photos'
    and public.requesting_staff_is_active()
  );
create policy "Active staff can remove own check-in photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'checkin-photos'
    and public.requesting_staff_is_active()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

notify pgrst, 'reload schema';
