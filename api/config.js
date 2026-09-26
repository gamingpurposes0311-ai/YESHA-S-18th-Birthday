module.exports = (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const url = process.env.SUPABASE_URL || "https://wqykpfhgadllzbmuknjz.supabase.co";
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!anonKey) {
    response.status(503).json({ error: "The Supabase publishable key is not configured on this deployment." });
    return;
  }

  response.status(200).json({ url, anonKey });
};
