alter table public.staff_accounts
  drop constraint if exists staff_accounts_role_check,
  add constraint staff_accounts_role_check
    check (role in ('superadmin', 'admin', 'staff'));

drop function if exists public.register_staff_account(text, text, text);

create or replace function public.manager_create_staff_account(
  p_actor_id uuid,
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
begin
  perform pg_catalog.pg_advisory_xact_lock(847261903);

  select role into actor_role
  from public.staff_accounts
  where id = p_actor_id and status = 'active';

  if actor_role is null or actor_role not in ('superadmin', 'admin') then
    raise exception using errcode = '42501', message = 'System manager access required';
  end if;

  if p_email is null
    or lower(trim(p_email)) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    or length(trim(p_email)) > 254
    or p_display_name is null
    or length(trim(p_display_name)) < 1
    or length(trim(p_display_name)) > 100
    or p_password is null
    or length(p_password) < 10
    or length(p_password) > 128
    or p_role is null
    or p_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'Invalid account details';
  end if;

  if actor_role = 'admin' and p_role <> 'staff' then
    raise exception using errcode = '42501', message = 'Administrators can create staff accounts only';
  end if;

  insert into public.staff_accounts (
    email,
    display_name,
    password_hash,
    role,
    status
  )
  values (
    lower(trim(p_email)),
    trim(p_display_name),
    extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
    p_role,
    'active'
  );

  return true;
end;
$$;

revoke all on function public.manager_create_staff_account(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.manager_create_staff_account(uuid, text, text, text, text)
  to service_role;

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
  perform pg_catalog.pg_advisory_xact_lock(847261903);

  select role into actor_role
  from public.staff_accounts
  where id = p_actor_id and status = 'active';

  if actor_role is null or actor_role not in ('superadmin', 'admin') then
    raise exception using errcode = '42501', message = 'System manager access required';
  end if;

  if p_status is null
    or p_status not in ('pending', 'active', 'rejected', 'suspended')
    or p_role is null
    or p_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'Invalid member state';
  end if;

  select role, status into target_role, target_status
  from public.staff_accounts
  where id = p_target_id
  for update;
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
    from public.staff_accounts
    where role = 'admin' and status = 'active';
    if active_admin_count <= 1 then
      raise exception using errcode = '42501', message = 'Cannot remove the last active administrator';
    end if;
  end if;

  update public.staff_accounts
  set role = p_role, status = p_status
  where id = p_target_id;
  return true;
end;
$$;

revoke all on function public.admin_update_staff_account(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_staff_account(uuid, uuid, text, text)
  to service_role;

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
  perform pg_catalog.pg_advisory_xact_lock(847261903);

  select role into actor_role
  from public.staff_accounts
  where id = p_actor_id and status = 'active';

  if actor_role is null or actor_role not in ('superadmin', 'admin') then
    raise exception using errcode = '42501', message = 'System manager access required';
  end if;
  if p_actor_id = p_target_id then
    raise exception using errcode = '42501', message = 'Cannot delete your own account';
  end if;

  select role, status into target_role, target_status
  from public.staff_accounts
  where id = p_target_id
  for update;
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
    from public.staff_accounts
    where role = 'admin' and status = 'active';
    if active_admin_count <= 1 then
      raise exception using errcode = '42501', message = 'Cannot delete the last active administrator';
    end if;
  end if;

  delete from public.staff_accounts where id = p_target_id;
  return true;
end;
$$;

revoke all on function public.admin_delete_staff_account(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_staff_account(uuid, uuid)
  to service_role;
