// Returns the VAPID public key so the client can call
// PushManager.subscribe({ applicationServerKey }). Public by design —
// the key is meant to be shipped to the browser. Private key stays
// server-side only (VAPID_PRIVATE_KEY env var).

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  if (!publicKey) {
    return res.status(503).json({ error: "Push not configured" });
  }
  // 5-minute cache is plenty — the key rotates very rarely (on a
  // deliberate rekey). Avoids a fetch on every install prompt.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  return res.status(200).json({ publicKey });
}
