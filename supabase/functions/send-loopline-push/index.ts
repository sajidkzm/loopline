import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-loopline-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  const a = Date.parse(start + "T00:00:00Z");
  const b = Date.parse(end + "T00:00:00Z");
  return Math.floor((b - a) / 86400000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  if (req.method === "GET") {
    if (!publicKey) return json({ error: "Push is not configured yet." }, 503);
    return json({ publicKey });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("LOOPLINE_CRON_SECRET");
  if (!cronSecret || req.headers.get("x-loopline-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@loopline.app";
  if (!url || !serviceKey || !publicKey || !privateKey) {
    return json({ error: "Push sender secrets are incomplete." }, 503);
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const today = utcDate();
  const { data: users, error: usersError } = await db
    .from("loopline_personal_state")
    .select("user_id,state");
  if (usersError) return json({ error: usersError.message }, 500);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of users || []) {
    const userId = row.user_id as string;
    const state = (row.state || {}) as {
      tasks?: Array<{ id?: string; title?: string; stage?: string; createdAt?: string }>;
      reminders?: Array<{ id?: string; name?: string; nextDue?: string }>;
    };

    const events: Array<{ key: string; title: string; body: string }> = [];
    for (const task of state.tasks || []) {
      if (!task?.id || !task.createdAt || task.stage === "closed") continue;
      const age = daysBetween(task.createdAt, today);
      if (age >= 10) {
        events.push({
          key: "task-10d-" + task.id,
          title: "A loop needs attention",
          body: (task.title || "A task") + " has been open for " + age + " days.",
        });
      }
    }

    for (const reminder of state.reminders || []) {
      if (!reminder?.id || !reminder.nextDue || reminder.nextDue > today) continue;
      const overdue = daysBetween(reminder.nextDue, today);
      events.push({
        key: "reminder-due-" + reminder.id + "-" + reminder.nextDue,
        title: overdue > 0 ? "Reminder overdue" : "Reminder due today",
        body: (reminder.name || "A reminder") + (overdue > 0
          ? " is overdue by " + overdue + (overdue === 1 ? " day." : " days.")
          : " is due today."),
      });
    }

    if (!events.length) continue;
    const { data: subscriptions, error: subError } = await db
      .from("loopline_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", userId);
    if (subError) {
      failed++;
      console.error("Subscription lookup failed for user", userId, subError);
      continue;
    }
    if (!subscriptions?.length) continue;

    for (const event of events) {
      const { error: logError } = await db
        .from("loopline_notification_log")
        .insert({ user_id: userId, notification_key: event.key });
      if (logError?.code === "23505") {
        skipped++;
        continue;
      }
      if (logError) {
        failed++;
        console.error("Notification log insert failed", logError);
        continue;
      }

      let eventSent = false;
      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: event.title, body: event.body, tag: event.key, url: "./" }),
          );
          eventSent = true;
          sent++;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await db.from("loopline_push_subscriptions").delete().eq("id", sub.id);
          }
          console.error("Push delivery failed", statusCode || "", error);
        }
      }

      if (!eventSent) {
        await db.from("loopline_notification_log")
          .delete()
          .eq("user_id", userId)
          .eq("notification_key", event.key);
        failed++;
      }
    }
  }

  return json({ ok: true, sent, skipped, failed, checkedAt: new Date().toISOString() });
});
