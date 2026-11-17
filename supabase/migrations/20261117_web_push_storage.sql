-- Loopline Web Push storage.
-- Browser subscriptions are private to the signed-in user/device.
-- Notification history is writable only by trusted backend code (service role).

create table if not exists public.loopline_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.loopline_push_subscriptions
  add column if not exists timezone text not null default 'UTC';

create index if not exists loopline_push_subscriptions_user_idx
  on public.loopline_push_subscriptions (user_id);

alter table public.loopline_push_subscriptions enable row level security;

drop policy if exists "Users manage their own push subscriptions"
  on public.loopline_push_subscriptions;

create policy "Users manage their own push subscriptions"
  on public.loopline_push_subscriptions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete
  on public.loopline_push_subscriptions to authenticated;

create table if not exists public.loopline_notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.loopline_push_subscriptions(id) on delete cascade,
  notification_key text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, subscription_id, notification_key)
);

alter table public.loopline_notification_log enable row level security;

-- Intentionally no authenticated policies or grants on notification history.
-- The scheduled sender uses the Supabase service role and can bypass RLS.
revoke all on public.loopline_notification_log from anon, authenticated;
