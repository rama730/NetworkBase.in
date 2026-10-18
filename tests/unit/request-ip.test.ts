import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getTrustedHeadersIp, getTrustedRequestIp, getTrustedSubnet } from "@/lib/security/request-ip";

const saved = { env: process.env.NODE_ENV, header: process.env.TRUSTED_PROXY_IP_HEADER, hops: process.env.TRUSTED_PROXY_HOPS };
function production(extra: Record<string, string> = {}) {
  Reflect.set(process.env, "NODE_ENV", "production");
  delete process.env.TRUSTED_PROXY_IP_HEADER;
  delete process.env.TRUSTED_PROXY_HOPS;
  Object.assign(process.env, extra);
}
afterEach(() => {
  Reflect.set(process.env, "NODE_ENV", saved.env);
  for (const [key, value] of [["TRUSTED_PROXY_IP_HEADER", saved.header], ["TRUSTED_PROXY_HOPS", saved.hops]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const ipOf = (headers: Record<string, string>) => getTrustedRequestIp(new Request("https://example.com/api/test", { headers }));

describe("trusted request ip", () => {
  it("takes the entry the trusted proxy appended, not what the client sent first", () => {
    production();
    assert.equal(ipOf({ "x-forwarded-for": "1.1.1.1, 203.0.113.10" }), "203.0.113.10");
    production({ TRUSTED_PROXY_HOPS: "2" });
    assert.equal(ipOf({ "x-forwarded-for": "1.1.1.1, 203.0.113.10, 198.51.100.5" }), "203.0.113.10");
  });

  it("ignores spoofable marker headers and x-real-ip unless configured", () => {
    production();
    assert.equal(ipOf({ "x-real-ip": "1.1.1.1", "cf-ray": "abc" }), null);
    production({ TRUSTED_PROXY_IP_HEADER: "CF-Connecting-IP" });
    assert.equal(ipOf({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "1.1.1.1" }), "198.51.100.9");
    assert.equal(getTrustedHeadersIp(new Headers({ "cf-connecting-ip": "198.51.100.9" })), "198.51.100.9");
  });

  it("treats a value that is not an IP address as unknown", () => {
    production();
    assert.equal(ipOf({ "x-forwarded-for": "not-an-ip" }), null);
    assert.equal(ipOf({ "x-forwarded-for": "1.1.1.1, 999.1.1.1" }), null);
  });

  it("buckets IPv4 /24 and IPv6 /64, folding equivalent spellings", () => {
    assert.equal(getTrustedSubnet("203.0.113.77"), "203.0.113.0/24");
    assert.equal(getTrustedSubnet("::ffff:203.0.113.77"), "203.0.113.0/24");
    assert.equal(getTrustedSubnet("2001:db8:1:2::1"), "2001:db8:1:2::/64");
    assert.equal(getTrustedSubnet("2001:0DB8:0001:0002:0:0:0:9"), "2001:db8:1:2::/64");
    assert.equal(getTrustedSubnet("2001:db8::1"), "2001:db8:0:0::/64");
    assert.equal(getTrustedSubnet("garbage"), "unknown-subnet");
    assert.equal(getTrustedSubnet(null), "unknown-subnet");
  });
});
