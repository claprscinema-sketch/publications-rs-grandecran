// Base partagée du Cinéma Grand Écran : Excel, images et infos des films (Netlify Blobs)
// GET  /api/base/manifest          → état de la base
// GET  /api/base/check-site        → vérifie le code d'accès au site (CODE_EQUIPE)
// GET  /api/base/check-pb          → vérifie le code des onglets PB et des bases communes (CODE_PB, sinon CODE_EQUIPE)
// GET  /api/base/file/<clé>         → un fichier
// PUT  /api/base/file/<clé>         → enregistre un fichier        (code d'équipe si défini)
// PUT  /api/base/manifest          → enregistre l'état            (code d'équipe si défini)
// DELETE /api/base/prefix/<début>   → supprime les fichiers d'un dossier (code d'équipe si défini)
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "grand-ecran", consistency: "strong" });
  const path = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/base\/?/, ""));
  const code = (globalThis.Netlify?.env?.get("CODE_EQUIPE") ?? process.env.CODE_EQUIPE ?? "").trim();
  const nostore = { "cache-control": "no-store" };

  if (req.method === "GET") {
    if (path === "check-site") {   // accès au site : code d'équipe CODE_EQUIPE
      const ok = !code || (req.headers.get("x-code") || "").trim() === code;
      return new Response(ok ? "ok" : "code", { status: ok ? 200 : 401, headers: nostore });
    }
    if (path === "check-pb") {   // accès aux onglets PB : code CODE_PB (sinon code d'équipe)
      const pb = (globalThis.Netlify?.env?.get("CODE_PB") ?? process.env.CODE_PB ?? "").trim() || code;
      return new Response(!pb || (req.headers.get("x-code") || "").trim() === pb ? "ok" : "code", { status: !pb || (req.headers.get("x-code") || "").trim() === pb ? 200 : 401, headers: nostore });
    }
    if (path === "manifest") {
      const m = await store.get("manifest", { type: "json" });
      return Response.json(m || {}, { headers: nostore });
    }
    if (path.startsWith("file/")) {
      const r = await store.getWithMetadata(path.slice(5), { type: "arrayBuffer" });
      if (!r) return new Response("absent", { status: 404 });
      return new Response(r.data, { headers: { ...nostore, "content-type": r.metadata?.type || "application/octet-stream" } });
    }
    return new Response("inconnu", { status: 404 });
  }

  if (code && (req.headers.get("x-code") || "").trim() !== code) return new Response("code", { status: 401 });

  if (req.method === "PUT" && path === "manifest") {
    const m = await req.json();
    m.updatedAt = new Date().toISOString();
    await store.setJSON("manifest", m);
    return Response.json(m, { headers: nostore });
  }
  if (req.method === "PUT" && path.startsWith("file/")) {
    const buf = await req.arrayBuffer();
    await store.set(path.slice(5), buf, { metadata: { type: req.headers.get("content-type") || "" } });
    return Response.json({ ok: true, size: buf.byteLength });
  }
  if (req.method === "DELETE" && path.startsWith("prefix/")) {
    const { blobs } = await store.list({ prefix: path.slice(7) });
    for (const b of blobs) await store.delete(b.key);
    return Response.json({ deleted: blobs.length });
  }
  return new Response("inconnu", { status: 404 });
};

export const config = { path: "/api/base/*" };
