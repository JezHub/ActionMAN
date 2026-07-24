import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// The server-side security boundary: every data route verifies the Google
// access token and enforces the allowlist. The client-side check is UX only.
const DEFAULT_ALLOWED_EMAILS = ["jazz@smallathon.com", "jez@smileathon.com"];

export function getAllowedEmails(): string[] {
  const fromEnv = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_EMAILS;
}

// token-hash -> verified email, so raw Gmail-scoped tokens are never map keys.
// TTL keeps Google userinfo calls to ~1 per 5 minutes despite 20s polling.
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const tokenCache = new Map<string, { email: string; expiresAt: number }>();

function pruneTokenCache() {
  const now = Date.now();
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
}

async function verifyGoogleToken(token: string): Promise<string | null> {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const cached = tokenCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.email;
  }

  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  if (!data.email) return null;

  const email = data.email.toLowerCase();
  pruneTokenCache();
  tokenCache.set(hash, { email, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return email;
}

export interface AuthedRequest extends Request {
  userEmail?: string;
}

export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    // Dev-only bypass for sandbox/API testing. Inert unless the env var is
    // explicitly set AND we are not in production.
    const bypass = process.env.DEV_AUTH_BYPASS_EMAIL;
    let email: string | null = null;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    // Background agents (Claude Routines etc.) authenticate with the shared
    // AGENT_API_TOKEN secret and act as the owner account. The token must be
    // long enough to be unguessable, and comparison is constant-time.
    const agentToken = process.env.AGENT_API_TOKEN || "";
    const isAgentAuth =
      agentToken.length >= 32 &&
      token.length === agentToken.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(agentToken));

    if (isAgentAuth) {
      email = (process.env.AGENT_ACTS_AS_EMAIL || getAllowedEmails()[0]).trim().toLowerCase();
    } else if (bypass && process.env.NODE_ENV !== "production") {
      email = bypass.trim().toLowerCase();
    } else {
      if (!token) {
        return res.status(401).json({ error: "Missing authorization token." });
      }
      email = await verifyGoogleToken(token);
      if (!email) {
        return res.status(401).json({ error: "unauthorized: invalid or expired Google token" });
      }
    }

    if (!getAllowedEmails().includes(email)) {
      return res.status(403).json({ error: "This account is not authorized to use Action Man." });
    }

    req.userEmail = email;
    next();
  } catch (err: any) {
    console.error("Auth middleware error:", err);
    res.status(500).json({ error: "Authentication check failed." });
  }
}
