-- Loopline team management: readable invite codes and owner-only deletion.
-- Existing teams receive a new alphabetic code. No team data is deleted by this migration.

do $$
declare
  team_row record;
  new_code text;
begin
  for team_row in select id from public.loopline_workspaces loop
    loop
      new_code := 'LOOP-' || translate(
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
        '0123456789abcdef',
        'ABCDEFGHIJKLMNOP'
      );
      exit when not exists (
        select 1 from public.loopline_workspaces
        where invite_code = new_code and id <> team_row.id
      );
    end loop;

    update public.loopline_workspaces
    set invite_code = new_code
    where id = team_row.id;
  end loop;
end;
$$;

create unique index if not exists loopline_workspaces_invite_code_uidx
  on public.loopline_workspaces (invite_code);

create or replace function public.loopline_create_workspace(p_name text)
returns table (
  workspace_id uuid,
  workspace_name text,
  invite_code text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_workspace_id uuid;
  v_invite_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to create a team';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Team name is required';
  end if;

  loop
    v_invite_code := 'LOOP-' || translate(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      '0123456789abcdef',
      'ABCDEFGHIJKLMNOP'
    );
    exit when not exists (
      select 1 from public.loopline_workspaces w
      where w.invite_code = v_invite_code
    );
  end loop;

  insert into public.loopline_workspaces (name, created_by, invite_code)
  values (trim(p_name), (select auth.uid()), v_invite_code)
  returning id into v_workspace_id;

  insert into public.loopline_shared_state (workspace_id, state, updated_by)
  values (
    v_workspace_id,
    '{"tasks":[],"rewards":[],"reminders":[],"activityDates":[],"claimedBadges":[]}'::jsonb,
    (select auth.uid())
  )
  on conflict (workspace_id) do nothing;

  return query
    select w.id, w.name, w.invite_code
    from public.loopline_workspaces as w
    where w.id = v_workspace_id;
end;
$$;

create or replace function public.loopline_join_workspace(p_invite_code text)
returns table (
  workspace_id uuid,
  workspace_name text,
  member_role text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to join a team';
  end if;

  if p_invite_code is null or length(trim(p_invite_code)) = 0 then
    raise exception 'Invitation code is required';
  end if;

  select w.id
    into v_workspace_id
    from public.loopline_workspaces as w
    where upper(w.invite_code) = upper(trim(p_invite_code))
    limit 1;

  if v_workspace_id is null then
    raise exception 'Invalid invitation code';
  end if;

  insert into public.loopline_workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, (select auth.uid()), 'member')
  on conflict (workspace_id, user_id) do nothing;

  return query
    select w.id, w.name, m.role
    from public.loopline_workspaces as w
    join public.loopline_workspace_members as m
      on m.workspace_id = w.id
    where w.id = v_workspace_id
      and m.user_id = (select auth.uid());
end;
$$;

create or replace function public.loopline_delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to delete a team';
  end if;

  select w.created_by
    into v_owner_id
    from public.loopline_workspaces as w
    where w.id = p_workspace_id;

  if v_owner_id is null then
    raise exception 'Team not found';
  end if;

  if v_owner_id <> (select auth.uid()) then
    raise exception 'Only the team owner can delete this team';
  end if;

  delete from public.loopline_shared_state
  where workspace_id = p_workspace_id;

  delete from public.loopline_workspace_members
  where workspace_id = p_workspace_id;

  delete from public.loopline_workspaces
  where id = p_workspace_id;
end;
$$;

revoke all on function public.loopline_create_workspace(text) from public, anon;
grant execute on function public.loopline_create_workspace(text) to authenticated;

revoke all on function public.loopline_join_workspace(text) from public, anon;
grant execute on function public.loopline_join_workspace(text) to authenticated;

revoke all on function public.loopline_delete_workspace(uuid) from public, anon;
grant execute on function public.loopline_delete_workspace(uuid) to authenticated;
