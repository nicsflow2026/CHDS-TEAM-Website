// CHDS AI Support: first-line support with resolution detection and human escalation (Groq only).
import { aiChat } from "./core.js";

// Business instructions from the original api/chat.js, kept word for word except the button label,
// which now matches the new "Talk to a Human Agent" button.
export const BASE_SYSTEM = `You are CHDS AI Support, the professional support assistant of CH Digital Services.
Scope: Facebook (and Instagram) account and page problems such as hacked, disabled, locked, restricted, lost admin access, 2FA lockout, impersonation, ad account issues, plus questions about our custom website service. Politely decline anything unrelated.
Behave like a senior intake specialist: acknowledge the problem in one sentence, ask at most two focused questions (what happened, when, whether they still have access to the linked email or phone, any error or notice shown), and ask for a screenshot of the error, notice or email when it would help. If the user's message contains "[Screenshot text extracted by OCR]", use it to understand the case and summarize what you see.
Strict rules: NEVER give step-by-step instructions, tutorials, tricks or methods for recovering, bypassing or accessing an account; explain that the CHDS team handles cases directly. Never ask for passwords, login codes or ID documents, and warn users never to share them. Never promise or guarantee recovery or timelines. Never invent prices or statistics. When the user wants a person, needs a quote or a case review, tell them to tap "Talk to a Human Agent". Keep replies under 4 short sentences. Plain text only: no markdown, no asterisks, no bullet lists, no headings. Reply in the user's language (English or Filipino).`;

export const CATEGORIES = ["hacked", "disabled", "locked", "page_access", "impersonation", "ad_account", "website", "general", "other"];
export const REASONS = ["user_requested", "knowledge_limit", "manual_investigation", "account_action", "authorized_member", "unresolved_after_steps", "repeated_failure", "rejected_resolution", "other"];
export const REASON_LABEL = {
  user_requested: "Customer asked for a human", knowledge_limit: "Outside what the AI can answer", manual_investigation: "Needs manual investigation",
  account_action: "Needs account-level action", authorized_member: "Needs an authorized team member (quote / case review)",
  unresolved_after_steps: "Still unresolved after the AI's guidance", repeated_failure: "Repeated unsuccessful attempts",
  rejected_resolution: "Customer said the AI did not resolve it", other: "Other"
};
export const CATEGORY_LABEL = { hacked: "Hacked account", disabled: "Disabled / suspended", locked: "Locked out / 2FA", page_access: "Lost Page admin access",
  impersonation: "Impersonation", ad_account: "Ad account", website: "Website service", general: "General question", other: "Other" };

const CONTROL = `
Conversation rules (added for CHDS AI Support v2):
- You can see this conversation's earlier messages, plus any notes from CHDS human agents. Never ask again for something the user already told you, and never repeat a question that was already answered. If a human agent left a note, continue from it.
- Never claim you did anything outside this chat: you cannot open tickets, contact Meta, check accounts, or forward a case yourself. Never invent CHDS policies, prices or timelines. If you are not sure, say so plainly.
- After your reply, add ONE final line that the user never sees, exactly in this form:
<<chds {"state":"continue","category":"general","reason":"none"}>>
  state: "continue" while you are still helping; "confirm" only when you believe the user's question is fully answered and nothing is pending; "human" when a CHDS team member should take over (the user asks for a person, wants a quote or a case review, the case needs account access, manual investigation or an authorized team member, you lack the knowledge to answer, or repeated attempts did not work).
  category: one of ${CATEGORIES.join(", ")}.
  reason: "none", or when state is "human" one of ${REASONS.filter(r => r !== "rejected_resolution").join(", ")}.`;
export const SYSTEM = BASE_SYSTEM + "\n" + CONTROL;

// Deterministic signals (English + Filipino). They complement the model's own control line.
export const HUMAN_RE = /(real|live)\s*(human|person|agent)|human\s*(support|agent)|talk to (a |an )?(human|person|agent|someone|staff)|speak (to|with) (a |an )?(human|person|agent|someone)|connect.*(human|agent|person)|(customer service )?representative|totoong\s*tao|kausapin.*(tao|agent|admin)|makausap.*(tao|agent|admin)/i;
export const RESOLVED_RE = /\b(that (helped|worked|solved it|answers it)|it works now|working now|problem solved|issue (is )?(solved|resolved|fixed)|all (good|set)|i('m| am) (good|ok|okay) now|no (more|other) questions|that'?s all,? thanks?|thank you,? that('?s| is) all|got it,? thank|i understand now|okay na|ok na|ayos na|gets ko na|naintindihan ko na|salamat,? (ok|okay|ayos) na)\b/i;
export const UNRESOLVED_RE = /(still (not|doesn'?t|can'?t|isn'?t|won'?t|getting|the same)|didn'?t (work|help)|doesn'?t work|not working|same (error|problem|issue|message)|tried (that|it|everything|already)|nothing works|hindi (pa rin|gumana|umubra)|ayaw (pa rin|gumana)|di pa rin|wala pa ring)/i;
export const AUTHORIZED_RE = /\b(quote|quotation|pricing|price|how much|magkano|payment|paid|refund|invoice|case status|status of my case|update on my case|follow[- ]?up on my case)\b/i;

export function detect(text) {
  const t = String(text || "");
  return { human: HUMAN_RE.test(t), resolved: RESOLVED_RE.test(t) && !UNRESOLVED_RE.test(t), unresolved: UNRESOLVED_RE.test(t), authorized: AUTHORIZED_RE.test(t) };
}

// Pull the hidden control line out of a model reply. Never throws.
export function parseSignal(reply) {
  const raw = String(reply || "");
  let sig = { state: "continue", category: null, reason: null, parsed: false };
  const m = /<<\s*chds\s*(\{[\s\S]*?\})\s*>>/i.exec(raw);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      sig = { state: ["continue", "confirm", "human"].includes(j.state) ? j.state : "continue", category: CATEGORIES.includes(j.category) ? j.category : null,
        reason: REASONS.includes(j.reason) ? j.reason : null, parsed: true };
    } catch { /* malformed control line: keep defaults */ }
  }
  const text = raw.replace(/<<\s*chds[\s\S]*?(>>|$)/gi, "").replace(/\*\*/g, "").trim();
  return { text, signal: sig };
}

// Combine model signal + deterministic rules into what the client should show.
export function decide({ userText, signal, failureCount, threshold = 2, priorConfirm = false }) {
  const d = detect(userText);
  let failures = failureCount + (d.unresolved ? 1 : 0);
  let offerHuman = false, reason = null, askConfirm = false;
  if (d.human) { offerHuman = true; reason = "user_requested"; }
  else if (d.unresolved && priorConfirm) { offerHuman = true; reason = "rejected_resolution"; }
  else if (failures >= threshold) { offerHuman = true; reason = d.unresolved ? "repeated_failure" : "unresolved_after_steps"; }
  else if (signal.state === "human") { offerHuman = true; reason = signal.reason && signal.reason !== "none" ? signal.reason : "knowledge_limit"; }
  else if (d.authorized) { offerHuman = true; reason = "authorized_member"; }
  if (!offerHuman && (signal.state === "confirm" || d.resolved)) askConfirm = true;
  return { offerHuman, reason, askConfirm, failures, category: signal.category };
}

// Build the model context from the stored transcript (oldest → newest). Agent messages and handback
// notes are included so the AI continues where a human left off.
export function historyFor(rows, { maxMsgs = 24, maxChars = 12000 } = {}) {
  const out = [];
  for (const m of rows.slice(-maxMsgs)) {
    if (m.role === "user") out.push({ role: "user", content: m.body + (m.meta && m.meta.ocr ? `\n\n[Screenshot text extracted by OCR]\n${String(m.meta.ocr).slice(0, 1200)}` : "") });
    else if (m.role === "assistant") out.push({ role: "assistant", content: m.body });
    else if (m.role === "agent") out.push({ role: "assistant", content: `[CHDS human agent ${m.author || ""}]: ${m.body}` });
    else if (m.role === "note") out.push({ role: "system", content: `Note from a CHDS human agent (not visible to the user): ${m.body}` });
    else if (m.role === "summary") out.push({ role: "system", content: `Earlier AI-generated summary of this case: ${m.body}` });
  }
  let total = 0; const kept = [];
  for (let i = out.length - 1; i >= 0; i--) { total += out[i].content.length; if (total > maxChars) break; kept.unshift(out[i]); }
  while (kept.length && kept[0].role === "assistant") kept.shift();
  return kept;
}

// Handoff summary for the human agent. AI-generated when Groq answers; otherwise a clearly-labelled
// excerpt of the customer's own words (never invented).
export async function summarize(rows, reason) {
  const transcript = rows.filter(m => ["user", "assistant", "agent", "note"].includes(m.role)).slice(-30)
    .map(m => `${m.role === "user" ? "CUSTOMER" : m.role === "assistant" ? "AI" : m.role === "agent" ? "AGENT" : "AGENT NOTE"}: ${m.body.slice(0, 600)}${m.meta && m.meta.ocr ? " [screenshot text: " + String(m.meta.ocr).slice(0, 300) + "]" : ""}`).join("\n");
  const fallback = () => {
    const users = rows.filter(m => m.role === "user");
    return { generated_by: "fallback", category: null, summary: users.length ? `Customer's own words (AI summary unavailable): "${users.slice(0, 2).map(m => m.body.slice(0, 200)).join(" … ")}"` : "No customer messages yet.",
      attempted: [], results: "", unresolved: users.length ? users.at(-1).body.slice(0, 300) : "", escalation_reason: reason };
  };
  if (!transcript) return fallback();
  const o = await aiChat([
    { role: "system", content: `You prepare handoff notes for CHDS human support agents. Read the transcript and output ONLY a JSON object with keys:
"category" (one of ${CATEGORIES.join(", ")}), "summary" (2-4 plain sentences: what the customer needs and the key facts they gave), "attempted" (array of short strings: what the AI already asked or explained), "results" (what came of it), "unresolved" (the open question or problem, one sentence).
Use only facts from the transcript. Do not invent details, names, prices or outcomes. If something is unknown, say "unknown".` },
    { role: "user", content: transcript.slice(-9000) }
  ], { max: 500, budget: 15000, json: true });
  if (!o.ok) return fallback();
  try {
    const j = JSON.parse(o.reply.replace(/^```(json)?|```$/g, "").trim());
    const s = v => String(v || "").replace(/\s+/g, " ").trim();
    return { generated_by: "ai:" + o.model, category: CATEGORIES.includes(j.category) ? j.category : null, summary: s(j.summary).slice(0, 1200) || fallback().summary,
      attempted: (Array.isArray(j.attempted) ? j.attempted : []).map(s).filter(Boolean).slice(0, 8).map(x => x.slice(0, 200)),
      results: s(j.results).slice(0, 400), unresolved: s(j.unresolved).slice(0, 400), escalation_reason: reason };
  } catch { return fallback(); }
}
