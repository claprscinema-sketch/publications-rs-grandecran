// IA du Cinéma Grand Écran (infos et synopsis des films, résumés) — la clé reste sur Netlify, jamais dans la page.
// POST /api/ai   { system, prompt, image?: "<jpeg en base64>", search?: true }  →  { text, via }
// Clé à mettre dans Netlify > Site configuration > Environment variables (une seule suffit) :
//   GEMINI_KEY        clé Google AI Studio (gratuite) — recommandé : recherche Google pour les films récents
//   POLLINATIONS_KEY  clé secrète sk_… de enter.pollinations.ai
//   ANTHROPIC_KEY     clé de console.anthropic.com
// Facultatif : AI_MODEL pour choisir le modèle.
const env = k => (globalThis.Netlify?.env?.get(k) ?? process.env[k] ?? "").trim();

// modèle : AI_MODEL, sinon le dernier « Flash » de Google (alias tenu à jour), puis un modèle connu en secours
async function gemini(key, b) {
  let last;
  for (const model of [env("AI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean)) {
    try { return await geminiModel(key, b, model); } catch (e) { last = e; if (!/ 404 | 400 /.test(" " + e.message + " ")) throw e; }
  }
  throw last;
}
async function geminiModel(key, b, model) {
  const parts = [{ text: b.prompt }];
  if (b.image) parts.push({ inline_data: { mime_type: "image/jpeg", data: b.image } });
  const body = { contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2 } };
  if (b.system) body.systemInstruction = { parts: [{ text: b.system }] };
  if (b.search !== false) body.tools = [{ google_search: {} }];          // fiches à jour pour les films récents
  const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });   // clé en en-tête : marche pour les anciennes (AIza…) et les nouvelles (AQ.…)
  let r = await call();
  if (!r.ok && body.tools) { delete body.tools; r = await call(); }   // sans recherche si elle est refusée (offre gratuite)
  if (!r.ok) throw new Error(`Gemini ${r.status} ${model} : ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
}
async function pollinations(key, b) {
  const content = b.image ? [{ type: "text", text: b.prompt }, { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b.image } }] : b.prompt;
  const r = await fetch("https://gen.pollinations.ai/v1/chat/completions", { method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({ model: env("AI_MODEL") || "openai", messages: [...(b.system ? [{ role: "system", content: b.system }] : []), { role: "user", content }] }) });
  if (!r.ok) throw new Error(`Pollinations ${r.status} : ${(await r.text()).slice(0, 300)}`);
  const j = await r.json(); return j.choices?.[0]?.message?.content || "";
}
async function anthropic(key, b) {
  const content = [{ type: "text", text: b.prompt }];
  if (b.image) content.unshift({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.image } });
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env("AI_MODEL") || "claude-sonnet-4-5", max_tokens: 1500, system: b.system || undefined, messages: [{ role: "user", content }] }) });
  if (!r.ok) throw new Error(`Anthropic ${r.status} : ${(await r.text()).slice(0, 300)}`);
  const j = await r.json(); return (j.content || []).map(c => c.text || "").join("");
}

export default async (req) => {
  const nostore = { "cache-control": "no-store" };
  if (req.method === "GET") {        // état : une clé est-elle configurée ?
    const via = env("GEMINI_KEY") ? "gemini" : env("POLLINATIONS_KEY") ? "pollinations" : env("ANTHROPIC_KEY") ? "anthropic" : "";
    return Response.json({ ok: !!via, via }, { headers: nostore });
  }
  if (req.method !== "POST") return new Response("inconnu", { status: 404 });
  const code = env("CODE_EQUIPE");
  if (code && (req.headers.get("x-code") || "").trim() !== code) return new Response("code", { status: 401 });
  let b; try { b = await req.json(); } catch (e) { return new Response("requête illisible", { status: 400 }); }
  if (!b || !b.prompt) return new Response("prompt manquant", { status: 400 });
  const tries = [["gemini", env("GEMINI_KEY"), gemini], ["pollinations", env("POLLINATIONS_KEY"), pollinations], ["anthropic", env("ANTHROPIC_KEY"), anthropic]].filter(t => t[1]);
  if (!tries.length) return new Response("aucune clé d'IA configurée sur Netlify (GEMINI_KEY)", { status: 501, headers: nostore });
  let last;
  for (const [via, key, fn] of tries) {
    try { const text = await fn(key, b); if (text) return Response.json({ text, via }, { headers: nostore }); last = new Error(via + " : réponse vide"); }
    catch (e) { last = e; }
  }
  return new Response(String(last?.message || last), { status: 502, headers: nostore });
};

export const config = { path: "/api/ai" };
