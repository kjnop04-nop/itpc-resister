alter table public.staff_accounts
  add column if not exists role text not null default 'staff',
  add column if not exists status text not null default 'active';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_accounts'
      and column_name = 'is_active'
  ) then
    execute $migration$
      update public.staff_accounts
      set status = case when is_active then 'active' else 'suspended' end
    $migration$;
  end if;
end;
$$;

alter table public.staff_accounts
  drop constraint if exists staff_accounts_role_check,
  add constraint staff_accounts_role_check check (role in ('admin', 'staff')),
  drop constraint if exists staff_accounts_status_check,
  add constraint staff_accounts_status_check
    check (status in ('pending', 'active', 'rejected', 'suspended'));

alter table public.staff_accounts
  drop column if exists is_active;

insert into public.staff_accounts (
  id,
  email,
  display_name,
  password_hash,
  role,
  status,
  created_at
)
select
  account.id,
  lower(account.email),
  coalesce(
    nullif(account.raw_user_meta_data ->> 'display_name', ''),
    nullif(account.raw_user_meta_data ->> 'full_name', ''),
    nullif(account.raw_user_meta_data ->> 'name', ''),
    account.email
  ),
  account.encrypted_password,
  'staff',
  'active',
  account.created_at
from auth.users as account
where account.email is not null
  and account.encrypted_password like '$2%'
on conflict (email) do nothing;

drop function if exists public.verify_staff_login(text, text);
create or replace function public.verify_staff_login(p_email text, p_password text)
returns table (id uuid, email text, display_name text, role text, status text)
language sql
security definer
set search_path = ''
as $$
  select account.id, account.email, account.display_name, account.role, account.status
  from public.staff_accounts as account
  where account.email = lower(p_email)
    and account.password_hash = extensions.crypt(p_password, account.password_hash);
$$;

revoke all on function public.verify_staff_login(text, text) from public, anon, authenticated;
grant execute on function public.verify_staff_login(text, text) to service_role;

create or replace function public.register_staff_account(
  p_email text,
  p_display_name text,
  p_password text
)
returns table (id uuid, email text, display_name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_account public.staff_accounts%rowtype;
begin
  if p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or length(p_email) > 254
    or length(trim(p_display_name)) < 1
    or length(trim(p_display_name)) > 100
    or length(p_password) < 10
    or length(p_password) > 128 then
    raise exception using errcode = '22023', message = 'Invalid account details';
  end if;

  insert into public.staff_accounts (
    email,
    display_name,
    password_hash,
    status
  )
  values (
    lower(trim(p_email)),
    trim(p_display_name),
    extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
    'pending'
  )
  returning * into created_account;

  return query
    select created_account.id, created_account.email,
      created_account.display_name, created_account.status;
end;
$$;

revoke all on function public.register_staff_account(text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_staff_account(text, text, text)
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
  current_role text;
  current_status text;
  active_admin_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(847261903);

  if not exists (
    select 1 from public.staff_accounts
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;

  if p_status not in ('pending', 'active', 'rejected', 'suspended')
    or p_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'Invalid member state';
  end if;
  if p_actor_id = p_target_id and (p_status <> 'active' or p_role <> 'admin') then
    raise exception using errcode = '42501', message = 'Cannot remove your own administrator access';
  end if;

  select role, status into current_role, current_status
  from public.staff_accounts where id = p_target_id for update;
  if not found then
    return false;
  end if;

  if current_role = 'admin' and current_status = 'active'
    and (p_role <> 'admin' or p_status <> 'active') then
    select count(*) into active_admin_count
    from public.staff_accounts where role = 'admin' and status = 'active';
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
  target_role text;
  target_status text;
  active_admin_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(847261903);

  if not exists (
    select 1 from public.staff_accounts
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  if p_actor_id = p_target_id then
    raise exception using errcode = '42501', message = 'Cannot delete your own account';
  end if;

  select role, status into target_role, target_status
  from public.staff_accounts where id = p_target_id for update;
  if not found then
    return false;
  end if;

  if target_role = 'admin' and target_status = 'active' then
    select count(*) into active_admin_count
    from public.staff_accounts where role = 'admin' and status = 'active';
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
