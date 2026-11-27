do $$
declare
  table_names text[][] := array[
    array['staff_accounts', 'itpc_register_staff_accounts'],
    array['registrations', 'itpc_register_registrations'],
    array['checkins', 'itpc_register_checkins'],
    array['academic_year_settings', 'itpc_register_academic_year_settings'],
    array['staff_login_attempts', 'itpc_register_staff_login_attempts']
  ];
  table_name_pair text[];
  function_row record;
  function_definition text;
begin
  foreach table_name_pair slice 1 in array table_names loop
    if to_regclass('public.' || table_name_pair[1]) is not null then
      if to_regclass('public.' || table_name_pair[2]) is not null then
        raise exception 'Both public.% and public.% exist',
          table_name_pair[1],
          table_name_pair[2];
      end if;

      execute format(
        'alter table public.%I rename to %I',
        table_name_pair[1],
        table_name_pair[2]
      );
    end if;
  end loop;

  for function_row in
    select p.oid
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    join pg_language as l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prokind = 'f'
      and l.lanname in ('sql', 'plpgsql')
      and p.prosrc ~ '\m(staff_accounts|registrations|checkins|academic_year_settings|staff_login_attempts)\M'
  loop
    function_definition := pg_get_functiondef(function_row.oid);
    foreach table_name_pair slice 1 in array table_names loop
      if to_regclass('public.' || table_name_pair[2]) is not null then
        function_definition := regexp_replace(
          function_definition,
          '\m' || table_name_pair[1] || '\M',
          table_name_pair[2],
          'g'
        );
      end if;
    end loop;
    execute function_definition;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
