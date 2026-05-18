import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:8080";

export const options = {
  scenarios: {
    browse_site: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "1m",
      gracefulStop: "5s",
    },
    spike_homepage: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: Number(__ENV.SPIKE_VUS || 25) },
        { duration: "20s", target: Number(__ENV.SPIKE_VUS || 25) },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

const pages = [
  { path: "/", name: "home" },
  { path: "/services/", name: "services" },
  { path: "/example-builds/", name: "example-builds" },
  { path: "/who-i-help/", name: "who-i-help" },
  { path: "/about/", name: "about" },
  { path: "/contact/", name: "contact" },
];

export default function () {
  const isSpike = (__ITER % 3) === 0;
  const page = isSpike ? pages[0] : pages[Math.floor(Math.random() * pages.length)];
  const res = http.get(`${baseUrl}${page.path}`, {
    tags: { page: page.name },
    redirects: 5,
  });

  check(res, {
    [`${page.name} returned 200`]: (r) => r.status === 200,
    [`${page.name} has html`]: (r) =>
      (r.headers["Content-Type"] || r.headers["content-type"] || "").includes("text/html"),
    [`${page.name} includes title`]: (r) => r.body.includes("Palmetto Business Automation"),
  });

  sleep(1);
}
