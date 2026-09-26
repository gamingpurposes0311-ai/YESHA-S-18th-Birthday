window.debutSupabaseReady = fetch("/api/config", { headers: { Accept: "application/json" }, cache: "no-store" })
  .then(async (response) => {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const config = isJson ? await response.json() : {};
    if (response.status === 404 && !isJson) throw new Error("Supabase settings are not available on this static server. Run this site with Vercel or `vercel dev`.");
    if (!response.ok) throw new Error(config.error || "Supabase configuration is unavailable.");
    if (!isJson) throw new Error("Supabase settings are unavailable because the configuration response was not JSON.");
    if (!window.supabase?.createClient) throw new Error("The Supabase browser library did not load.");
    return window.supabase.createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
  })
  .catch((error) => {
    window.debutSupabaseError = error;
    throw error;
  });
