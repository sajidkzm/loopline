-- Fix PL/pgSQL ambiguity between RETURNS TABLE output variables
-- and table columns named workspace_id in ON CONFLICT clauses.

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
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to create a workspace';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Workspace name is required';
  end if;

  insert into public.loopline_workspaces (name, created_by)
  values (trim(p_name), (select auth.uid()))
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
    raise exception 'You must be signed in to join a workspace';
  end if;

  if p_invite_code is null or length(trim(p_invite_code)) = 0 then
    raise exception 'Invitation code is required';
  end if;

  select w.id
    into v_workspace_id
    from public.loopline_workspaces as w
    where w.invite_code = trim(p_invite_code)
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
