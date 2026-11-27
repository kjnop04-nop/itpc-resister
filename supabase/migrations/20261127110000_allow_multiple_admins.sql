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
  perform pg_catalog.pg_advisory_xact_lock(847261903);

  select role into actor_role
  from public.staff_accounts
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

  insert into public.staff_accounts (
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
      pg_catalog.encode(extensions.digest('staff-password-v1:' || p_password, 'sha256'), 'hex'),
      extensions.gen_salt('bf', 12)
    ),
    'bcrypt-sha256',
    p_role,
    'active'
  );

  return true;
end;
$$;

revoke all on function public.manager_create_staff_account(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.manager_create_staff_account(uuid, text, text, text, text, text)
  to service_role;
