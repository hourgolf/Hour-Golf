import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const { email, password, name, phone, birthday } = req.body || {};

  // Validate required fields
  if (!email || !password || !name || !phone || !birthday) {
    return res.status(400).json({ error: "All fields are required: email, password, name, phone, birthday" });
  }

  const cleanEmail = email.toLowerCase().trim();

  // Validate password length
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  // Validate age (must be 18+)
  const birthDate = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  if (age < 18) {
    return res.status(400).json({ error: "You must be at least 18 years old to create an account" });
  }

  try {
    // Check if email already exists
    const existResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&select=email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (existResp.ok) {
      const existing = await existResp.json();
      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists. Please sign in instead." });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create member record
    const memberData = {
      email: cleanEmail,
      name: name.trim(),
      phone: phone.trim(),
      birthday,
      password_hash: passwordHash,
      tier: "Non-Member",
      terms_accepted_at: new Date().toISOString(),
      session_token: sessionToken,
      session_expires_at: expiresAt,
    };

    const createResp = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(memberData),
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      console.error("Member creation failed:", errText);
      throw new Error("Failed to create account");
    }

    // Create member_preferences record
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/member_preferences`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: cleanEmail,
          email_booking_confirmations: true,
          email_cancellations: true,
          email_reminders: true,
          email_billing: true,
        }),
      });
    } catch (_) { /* best effort */ }

    // Load tier config for Non-Member
    let tierConfig = null;
    try {
      const tierResp = await fetch(
        `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.Non-Member`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (tierResp.ok) {
        const rows = await tierResp.json();
        tierConfig = rows[0] || null;
      }
    } catch (_) {}

    // Set httpOnly cookie
    const isSecure = process.env.NODE_ENV === "production";
    const cookie = [
      `hg-member-token=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${24 * 60 * 60}`,
    ];
    if (isSecure) cookie.push("Secure");
    res.setHeader("Set-Cookie", cookie.join("; "));

    return res.status(200).json({
      member: {
        email: cleanEmail,
        name: name.trim(),
        tier: "Non-Member",
        phone: phone.trim(),
        needsAccountSetup: false,
      },
      tierConfig,
    });
  } catch (e) {
    console.error("Member signup error:", e);
    return res.status(500).json({ error: "Failed to create account", detail: e.message });
  }
}
