import { api, E, limited, jsonBody } from "../lib/core.js";
const SYSTEM = `You are CHDS AI Support, the professional support assistant of CH Digital Services.
Scope: Facebook (and Instagram) account and page problems such as hacked, disabled, locked, restricted, lost admin access, 2FA lockout, impersonation, ad account issues, plus questions about our custom website service. Politely decline anything unrelated.
Behave like a senior intake specialist: acknowledge the problem in one sentence, ask at most two focused questions (what happened, when, whether they still have access to the linked email or phone, any error or notice shown), and ask for a screenshot of the error, notice or email when it would help. If the user's message contains "[Screenshot text extracted by OCR]", use it to understand the case and summarize what you see.
Strict rules: NEVER give step-by-step instructions, tutorials, tricks or methods for recovering, bypassing or accessing an account; explain that the CHDS team handles cases directly. Never ask for passwords, login codes or ID documents, and warn users never to share them. Never promise or guarantee recovery or timelines. Never invent prices or statistics. When the user wants a person, needs a quote or a case review, tell them to tap "Talk to a human". Keep replies under 4 short sentences. Reply in the user's language (English or Filipino).`;
export default api(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const key = (E.GROQ_API_KEY || "").trim();
  if (!key) return res.status(503).json({ error: "not_configured" });
  if (await limited(req, "chat", 20, 60)) return res.status(429).json({ error: "rate_limited" });
  const m = (Array.isArray(jsonBody(req).messages) ? jsonBody(req).messages : []).slice(-8)
    .filter(x => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string" && x.content.trim())
    .map(x => ({ role: x.role, content: x.content.slice(0, 2500) }));
  while (m.length && m[0].role !== "user") m.shift();
  if (!m.length || m[m.length - 1].role !== "user") return res.status(400).json({ error: "bad_request" });
  const models = [...new Set([(E.GROQ_MODEL || "").trim(), "llama-3.3-70b-versatile", "llama-3.1-8b-instant"].filter(Boolean))];
  for (const model of models) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(20000),
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: 350, messages: [{ role: "system", content: SYSTEM }, ...m] })
      });
      if (r.ok) { const t = ((await r.json()).choices?.[0]?.message?.content || "").trim(); if (t) return res.json({ reply: t, model }); continue; }
      console.error("groq", model, r.status, (await r.text()).slice(0, 300));
      if (r.status === 401 || r.status === 403) return res.status(502).json({ error: "bad_key" });
    } catch (e) { console.error("groq", model, String(e)); }
  }
  res.status(502).json({ error: "upstream" });
});
