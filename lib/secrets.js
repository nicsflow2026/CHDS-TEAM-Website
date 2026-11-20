
export const POLICY_FAQ = {
  q: "Will CHDS Support ever ask for my password?",
  a: "No. CHDS Support will never ask you to share your account password. Never send your password through AI Support, Human Support, Telegram, chat messages, or any support form. Keep your password private."
};
export const REDACTION_NOTICE = "For your safety we removed what looked like a password, login code or token from your message. CHDS Support will never ask for your password or codes. Please keep them private.";
export const SAFE_REPLY = "For your security: CHDS Support will never ask for your password, one-time codes, login or recovery codes, cookies or tokens, so please do not share them with anyone. Tell me what happened in your own words instead.";

const LABEL = { password: "[password removed]", code: "[code removed]", cookie: "[cookie removed]", token: "[token removed]" };
const NOT_A_SECRET = new Set(("not wrong incorrect correct changed expired invalid working lost forgotten forgot reset the my a an still already being been hacked compromised " +
  "weak strong too very same different ok okay fine blocked locked required needed needs asked asking requested saved stored empty unknown " +
  "hindi mali nawala nakalimutan napalitan iba pareho ayaw").split(" "));
const CTX_SKIP = /\b(error|zip|postal|area|country|promo|reference|ref|tracking|case|order|invoice|ticket)\s*$/i;

const RULES = [
  ["password", /\b(password|passwd|pwd|passcode|pass\s?word|pass|contrase[ñn]a|pin)((?:\s+ko)?\s*(?:[:=]|\bis\b|\bwas\b|\bay\b|\bko\s+ay\b)\s*)(["'“‘]?)([^\s"'”’]{3,64})/gi,
    (m, k, sep, q, val) => NOT_A_SECRET.has(val.toLowerCase().replace(/[.,!?;:]+$/, "")) ? m : `${k}${sep}${LABEL.password}`],
  ["code", /\b((?:recovery|backup)\s*codes?)([^\d\n]{0,20})((?:\d{3,5}[\s-]?\d{3,5}[\s,;]*){1,10})/gi, (m, k, sep) => `${k}${sep}${LABEL.code} `],
  ["code", /\b(otp|one[-\s]?time\s*(?:pass(?:word|code)?|code|pin)|log-?\s?in\s*code|verification\s*code|confirmation\s*code|security\s*code|authenticat(?:ion|or)\s*code|auth\s*code|2fa(?:\s*code)?|two[-\s]?factor\s*code|code)\b([^\d\n]{0,25})(\d(?:[\s-]?\d){5,9})\b/gi,
    (m, k, sep, val, off, all) => (/^code$/i.test(k) && CTX_SKIP.test(all.slice(Math.max(0, off - 20), off))) ? m : `${k}${sep}${LABEL.code}`],
  ["code", /\b(code\s+ko|ang\s+code)(\s*(?:ay|is|:)?\s*)(\d(?:[\s-]?\d){5,7})\b/gi, (m, k, sep) => `${k}${sep}${LABEL.code}`],
  ["cookie", /\b(c_user|xs|datr|fr|sb|wd|presence|sessionid|csrftoken|ds_user_id|rur|mid|ig_did|shbid|shbts|session)\s*=\s*([^;\s]{6,})/gi, (m, k) => `${k}=${LABEL.cookie}`],
  ["cookie", /\b(cookies?)\s*[:=]\s*([^\n]{10,})/gi, (m, k) => `${k}: ${LABEL.cookie}`],
  ["token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => LABEL.token],
  ["token", /\bEAA[A-Za-z0-9]{30,}\b/g, () => LABEL.token],
  ["token", /\bgsk_[A-Za-z0-9]{20,}\b/g, () => LABEL.token],
  ["token", /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, () => LABEL.token],
  ["token", /\b(bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, (m, k) => `${k} ${LABEL.token}`],
  ["token", /\b(access[_\s-]?token|session[_\s-]?token|auth[_\s-]?token|refresh[_\s-]?token|api[_\s-]?key|secret[_\s-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}["']?/gi, (m, k) => `${k}: ${LABEL.token}`]
];

export function redactSecrets(input) {
  let text = String(input ?? "");
  const found = new Set();
  for (const [type, re, rep] of RULES) {
    text = text.replace(re, (...a) => { const out = rep(...a); if (out !== a[0]) found.add(type); return out; });
  }
  return { text, found: [...found] };
}

const SECRET_NOUN = String.raw`(?:pass\s?words?|passcodes?|passwd|otps?|one[-\s]?time\s*(?:pass(?:word|code)?s?|codes?|pins?)|log-?\s?in\s*codes?|verification\s*codes?|confirmation\s*codes?|security\s*codes?|authenticat(?:ion|or)\s*codes?|auth\s*codes?|2fa(?:\s*codes?)?|two[-\s]?factor\s*codes?|recovery\s*codes?|backup\s*codes?|(?:session\s*)?cookies?|access\s*tokens?|session\s*tokens?|login\s*credentials|credentials|(?:the\s+)?codes?\s+(?:we|facebook|meta|instagram|they)\s+sent)`;
const ASK = new RegExp(String.raw`\b(?:send|give|share|provide|type|enter|tell|forward|paste|reply\s+with|drop|post|upload|dm|message|show|need|require|want|kailangan|ibigay|ipadala|pakibigay|pakisend|pakipadala|i-?send|ibahagi|i-?type|sabihin|isend)\b[^.!?\n]{0,60}?\b${SECRET_NOUN}`, "i");
const WHAT_IS = new RegExp(String.raw`\bwhat(?:'s|\s+is|\s+are)\s+(?:your|the)\s+${SECRET_NOUN}`, "i");
const ANO = new RegExp(String.raw`\bano\s+(?:ang\s+)?${SECRET_NOUN}\s+mo`, "i");
const NEGATION = /\b(never|don'?t|do\s+not|dont|not|no\s+one|nobody|without|avoid|huwag|wag|hindi|bawal|stop)\b/i;
export function asksForSecret(input) {
  const s = String(input ?? "");
  for (const sentence of s.split(/(?<=[.!?\n])\s+/)) {
    if (!(ASK.test(sentence) || WHAT_IS.test(sentence) || ANO.test(sentence))) continue;
    if (NEGATION.test(sentence)) continue;
    return true;
  }
  return false;
}
