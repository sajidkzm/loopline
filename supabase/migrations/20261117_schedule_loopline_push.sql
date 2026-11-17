-- Loopline push sender schedule.
-- Run only after deploying send-loopline-push and storing the URL + cron secret
-- in Supabase Vault as "loopline_project_url" and "loopline_cron_secret".
-- This runs every 15 minutes. The function itself deduplicates notifications.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule(jobid)
from cron.job
where jobname = 'loopline-push-every-15-minutes';

select cron.schedule(
  'loopline-push-every-15-minutes',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopline_project_url')
        || '/functions/v1/send-loopline-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'loopline_publishable_key'),
        'x-loopline-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'loopline_cron_secret')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
