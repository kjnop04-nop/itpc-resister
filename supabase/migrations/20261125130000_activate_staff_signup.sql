update public.staff_accounts
set status = 'active'
where status = 'pending';

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
    'active'
  )
  returning * into created_account;

  return query
    select created_account.id, created_account.email,
      created_account.display_name, created_account.status;
end;
$$;
