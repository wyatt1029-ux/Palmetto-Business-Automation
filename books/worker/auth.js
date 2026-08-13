import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksByDomain = new Map();

const remoteKeys = (teamDomain) => {
  if (!jwksByDomain.has(teamDomain)) {
    jwksByDomain.set(
      teamDomain,
      createRemoteJWKSet(new URL(`${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`)),
    );
  }
  return jwksByDomain.get(teamDomain);
};

export async function requireOwner(request, env) {
  if (
    env.ENVIRONMENT === "development" &&
    env.DEV_BYPASS_AUTH === "true" &&
    env.DEV_OWNER_EMAIL
  ) {
    return { email: env.DEV_OWNER_EMAIL.toLowerCase(), name: "Development owner" };
  }

  if (!env.POLICY_AUD || !env.TEAM_DOMAIN || !env.OWNER_EMAIL) {
    throw Object.assign(new Error("Cloudflare Access is not configured."), { status: 503 });
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw Object.assign(new Error("Authentication is required."), { status: 401 });

  try {
    const { payload } = await jwtVerify(token, remoteKeys(env.TEAM_DOMAIN), {
      issuer: env.TEAM_DOMAIN.replace(/\/$/, ""),
      audience: env.POLICY_AUD,
    });
    const email = String(payload.email || "").toLowerCase();
    const allowed = env.OWNER_EMAIL.split(",").map((value) => value.trim().toLowerCase());
    if (!email || !allowed.includes(email)) {
      throw Object.assign(new Error("This account is not authorized."), { status: 403 });
    }
    return { email, name: payload.name || email };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("Your secure session is invalid or expired."), { status: 401 });
  }
}
