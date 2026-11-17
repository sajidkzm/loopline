# Loopline background push setup (development branch)

This feature is not active on the live website. Do not run these steps until the development branch has been reviewed and merged intentionally.

## What it does

- Sends personal task alerts after a task has remained open for 10 days.
- Sends personal reminder alerts on the due date and while overdue.
- Checks every 15 minutes and records a per-user deduplication key.
- Sends only to devices whose signed-in user opted in.
- Does not send shared-workspace alerts; Loopline does not yet assign shared tasks to individual members.

## Required setup after code review

1. Apply `supabase/migrations/20261117_web_push_storage.sql` in Supabase SQL Editor.
2. Deploy `supabase/functions/send-loopline-push` from this repository using the Supabase CLI:
   `supabase functions deploy send-loopline-push --project-ref uwlevtjsoehvmybfzncl`
3. Generate a VAPID key pair locally (do not paste private keys into chat or commit them):
   `npx web-push generate-vapid-keys`
4. In Supabase Dashboard → Edge Functions → Secrets, set:
   - `VAPID_PUBLIC_KEY` = generated public key
   - `VAPID_PRIVATE_KEY` = generated private key
   - `VAPID_SUBJECT` = a contact URI such as `mailto:your-real-email@example.com`
   - `LOOPLINE_CRON_SECRET` = a long random secret generated locally
   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
5. In Supabase SQL Editor, store the project URL and the same cron secret in Vault (replace the placeholders locally):
   ```sql
   select vault.create_secret('https://uwlevtjsoehvmybfzncl.supabase.co', 'loopline_project_url');
   select vault.create_secret('REPLACE_WITH_YOUR_CRON_SECRET', 'loopline_cron_secret');
   ```
6. Apply `supabase/migrations/20261117_schedule_loopline_push.sql` to schedule the sender every 15 minutes.
7. Test on the development URL using HTTPS, sign in, enable private cloud sync, then enable browser alerts. Allow notification permission in the browser.

## Important

- Never expose the VAPID private key, service-role key, or cron secret in frontend code, GitHub, or chat.
- Browser push requires a supported browser and notification permission. iOS browsers have additional Home Screen installation requirements.
- This code has not yet been deployed to Supabase or tested against the live project. Review and test before merging.
