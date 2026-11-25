create extension if not exists pgcrypto with schema extensions;

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  display_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

alter table public.staff_accounts enable row level security;
revoke all on table public.staff_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_accounts to service_role;

create or replace function public.verify_staff_login(p_email text, p_password text)
returns table (id uuid, email text, display_name text)
language sql
security definer
set search_path = ''
as $$
  select account.id, account.email, account.display_name
  from public.staff_accounts as account
  where account.email = lower(p_email)
    and account.is_active
    and account.password_hash = extensions.crypt(p_password, account.password_hash);
$$;

revoke all on function public.verify_staff_login(text, text) from public, anon, authenticated;
grant execute on function public.verify_staff_login(text, text) to service_role;

drop trigger if exists set_checkin_staff on public.checkins;
drop function if exists public.set_checkin_staff();
alter table public.checkins
  drop constraint if exists checkins_checked_in_by_fkey;
