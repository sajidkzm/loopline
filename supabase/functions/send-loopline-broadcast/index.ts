import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2.0.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = (Deno.env.get("LOOPLINE_ADMIN_EMAIL") || "").trim().toLowerCase();
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!url || !anon || !service || !adminEmail) return reply({ error: "Broadcast service is not configured." }, 503);

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply({ error: "Please sign in first." }, 401);
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.email || user.email.trim().toLowerCase() !== adminEmail) {
    return reply({ error: "You are not allowed to send Loopline announcements." }, 403);
  }

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  if (req.method === "GET") {
    const { data, error } = await db.from("loopline_broadcasts")
      .select("id,title,message,target_url,recipient_count,sent_count,failed_count,created_at")
      .order("created_at", { ascending: false }).limit(20);
    if (error) return reply({ error: "Could not load announcement history." }, 500);
    return reply({ history: data || [] });
  }
  if (!publicKey || !privateKey || !subject) return reply({ error: "Push notifications are not configured." }, 503);

  let input: { title?: unknown; message?: unknown; url?: unknown };
  try { input = await req.json(); } catch { return reply({ error: "Invalid request body." }, 400); }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const targetUrl = typeof input.url === "string" && input.url.trim() ? input.url.trim() : "./";
  if (!title || title.length > 80) return reply({ error: "Title must be 1–80 characters." }, 400);
  if (!message || message.length > 500) return reply({ error: "Message must be 1–500 characters." }, 400);
  if (targetUrl !== "./" && !/^https?:\/\//i.test(targetUrl)) return reply({ error: "Link must start with https:// or http://." }, 400);

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent, error: rateError } = await db.from("loopline_broadcasts")
    .select("id").eq("admin_user_id", user.id).gte("created_at", since);
  if (rateError) return reply({ error: "Could not verify sending limits." }, 500);
  if ((recent || []).length >= 3) return reply({ error: "For safety, wait 10 minutes before sending another announcement." }, 429);

  const { data: record, error: insertError } = await db.from("loopline_broadcasts")
    .insert({ admin_user_id: user.id, title, message, target_url: targetUrl })
    .select("id").single();
  if (insertError || !record) return reply({ error: "Could not save this announcement." }, 500);

  const { data: subscriptions, error: subError } = await db.from("loopline_push_subscriptions")
    .select("id,endpoint,p256dh,auth");
  if (subError) {
    await db.from("loopline_broadcasts").update({ failed_count: 1 }).eq("id", record.id);
    return reply({ error: "Could not load notification subscribers." }, 500);
  }

  const subs = subscriptions || [];
  let sent = 0, failed = 0;
  for (let i = 0; i < subs.length; i += 10) {
    const batch = subs.slice(i, i + 10);
    const results = await Promise.all(batch.map(async (sub) => {
      try {
        const subscription = { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } };
        const payload = await buildPushPayload({
          data: JSON.stringify({ title, body: message, tag: "loopline-broadcast-" + record.id, url: targetUrl }),
          options: { ttl: 86400 },
        }, subscription, { subject, publicKey, privateKey });
        const response = await fetch(sub.endpoint, payload);
        if (response.status === 404 || response.status === 410) {
          await db.from("loopline_push_subscriptions").delete().eq("id", sub.id);
          return false;
        }
        return response.ok;
      } catch (error) {
        console.error("Broadcast push failed:", error);
        return false;
      }
    }));
    for (const ok of results) ok ? sent++ : failed++;
  }

  await db.from("loopline_broadcasts").update({
    recipient_count: subs.length, sent_count: sent, failed_count: failed,
  }).eq("id", record.id);
  return reply({
    ok: true, recipientCount: subs.length, sent, failed,
    message: subs.length ? "Announcement processed for all registered push subscriptions." : "No users have enabled push notifications yet.",
  });
});
