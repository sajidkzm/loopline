create table if not exists public.loopline_broadcasts (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  title text not null,
  message text not null,
  target_url text not null default './',
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists loopline_broadcasts_created_at_idx on public.loopline_broadcasts (created_at desc);
alter table public.loopline_broadcasts enable row level security;
revoke all on public.loopline_broadcasts from anon, authenticated;
grant all privileges on public.loopline_broadcasts to service_role;
