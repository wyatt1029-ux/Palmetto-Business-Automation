import { discoverBusinesses } from "../../_lib/discovery.js";
import { assertSameOrigin, handleError, readJson, requireOwner, secureJson } from "../../_lib/security.js";

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    await requireOwner(request, env);
    const input = await readJson(request, 16_000);
    const results = await discoverBusinesses(input, env);
    return secureJson(results);
  } catch (error) {
    return handleError(error);
  }
}
