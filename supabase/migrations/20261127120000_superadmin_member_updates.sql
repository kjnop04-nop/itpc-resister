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
  current_role text;
  current_status text;
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

  select role, status into current_role, current_status
  from public.staff_accounts
  where id = p_target_id
  for update;
  if not found then
    return false;
  end if;

  if current_role = 'superadmin'
    or (actor_role = 'admin' and (current_role <> 'staff' or p_role <> 'staff'))
    or (actor_role = 'superadmin' and current_role not in ('admin', 'staff')) then
    raise exception using errcode = '42501', message = 'Insufficient permission for target account';
  end if;

  if p_actor_id = p_target_id and (p_status <> 'active' or p_role <> actor_role) then
    raise exception using errcode = '42501', message = 'Cannot remove your own administrator access';
  end if;

  if current_role = 'admin' and current_status = 'active'
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
