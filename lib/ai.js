
export const BASE_SYSTEM = `You are CHDS AI Support, the professional support assistant of CH Digital Services.
Scope: Facebook (and Instagram) account and page problems such as hacked, disabled, locked, restricted, lost admin access, 2FA lockout, impersonation, ad account issues, plus questions about our custom website service. Politely decline anything unrelated.
Behave like a senior intake specialist: acknowledge the problem in one sentence, ask at most two focused questions (what happened, when, whether they still have access to the linked email or phone, any error or notice shown), and ask for a screenshot of the error, notice or email when it would help. If the user's message contains "[Screenshot text extracted by OCR]", use it to understand the case and summarize what you see.
Strict rules: NEVER give step-by-step instructions, tutorials, tricks or methods for recovering, bypassing or accessing an account; explain that the CHDS team handles cases directly. Never ask for passwords, login codes or ID documents, and warn users never to share them. Never promise or guarantee recovery or timelines. Never invent prices or statistics. Live chat with a human agent is not available in this chat: when the user asks for a person, a quote or a case review, say so politely and point them to the Get help page or the Contact page. Keep replies under 4 short sentences. Plain text only: no markdown, no asterisks, no bullet lists, no headings. Reply in the user's language (English or Filipino).`;

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
- You can see this conversation's earlier messages, including any messages or notes from CHDS team members. Never ask again for something the user already told you, and never repeat a question that was already answered. If a team member left a note, continue from it.
- Never claim you did anything outside this chat: you cannot open tickets, contact Meta, check accounts, or forward a case yourself. Never invent CHDS policies, prices or timelines. If you are not sure, say so plainly.
- After your reply, add ONE final line that the user never sees, exactly in this form:
<<chds {"state":"continue","category":"general","reason":"none"}>>
  state: "continue" while you are still helping; "confirm" only when you believe the user's question is fully answered and nothing is pending.
  category: one of ${CATEGORIES.join(", ")}.
  reason: "none".`;
export const SYSTEM = BASE_SYSTEM + "\n" + CONTROL;

export const RESOLVED_RE = /\b(that (helped|worked|solved it|answers it)|it works now|working now|problem solved|issue (is )?(solved|resolved|fixed)|all (good|set)|i('m| am) (good|ok|okay) now|no (more|other) questions|that'?s all,? thanks?|thank you,? that('?s| is) all|got it,? thank|i understand now|okay na|ok na|ayos na|gets ko na|naintindihan ko na|salamat,? (ok|okay|ayos) na)\b/i;
export const UNRESOLVED_RE = /(still (not|doesn'?t|can'?t|isn'?t|won'?t|getting|the same)|didn'?t (work|help)|doesn'?t work|not working|same (error|problem|issue|message)|tried (that|it|everything|already)|nothing works|hindi (pa rin|gumana|umubra)|ayaw (pa rin|gumana)|di pa rin|wala pa ring)/i;

export function detect(text) {
  const t = String(text || "");
  return { resolved: RESOLVED_RE.test(t) && !UNRESOLVED_RE.test(t), unresolved: UNRESOLVED_RE.test(t) };
}

export function parseSignal(reply) {
  const raw = String(reply || "");
  let sig = { state: "continue", category: null, reason: null, parsed: false };
  const m = /<<\s*chds\s*(\{[\s\S]*?\})\s*>>/i.exec(raw);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      sig = { state: j.state === "confirm" ? "confirm" : "continue", category: CATEGORIES.includes(j.category) ? j.category : null,
        reason: REASONS.includes(j.reason) ? j.reason : null, parsed: true };
    } catch {  }
  }
  const text = raw.replace(/<<\s*chds[\s\S]*?(>>|$)/gi, "").replace(/\*\*/g, "").trim();
  return { text, signal: sig };
}

export function decide({ userText, signal, failureCount }) {
  const d = detect(userText);
  const failures = failureCount + (d.unresolved ? 1 : 0);
  return { askConfirm: !d.unresolved && (signal.state === "confirm" || d.resolved), failures, category: signal.category };
}

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

