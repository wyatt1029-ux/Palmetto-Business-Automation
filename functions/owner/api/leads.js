// Keep the browser-facing leads API inside the Cloudflare Access-protected
// /owner/* route while reusing the single implementation and validation layer.
export { onRequestGet, onRequestPost, onRequestPut } from "../../api/leads.js";
