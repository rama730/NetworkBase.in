import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUserAgent, cleanIpAddress } from "@/lib/utils/device";

describe("device parser & IP cleaner", () => {
  it("cleans postgres inet CIDR masks correctly", () => {
    assert.equal(cleanIpAddress("208.77.246.45/32"), "208.77.246.45");
    assert.equal(cleanIpAddress("49.47.253.132/32"), "49.47.253.132");
    assert.equal(cleanIpAddress("2001:db8::1/128"), "2001:db8::1");
    assert.equal(cleanIpAddress("unknown"), "IP unavailable");
    assert.equal(cleanIpAddress(null), "IP unavailable");
  });

  it("detects Chrome on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Chrome");
    assert.equal(res.os, "macOS");
  });

  it("detects Safari on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Safari");
    assert.equal(res.os, "macOS");
  });

  it("detects Edge on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Edge");
    assert.equal(res.os, "Windows");
  });

  it("detects Mobile Safari on iPhone", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Safari");
    assert.equal(res.os, "iOS");
  });

  it("detects Chrome on iOS (CriOS)", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Chrome");
    assert.equal(res.os, "iOS");
  });

  it("detects Chrome on Android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Chrome");
    assert.equal(res.os, "Android");
  });

  it("detects Arc browser", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Arc/1.50.0";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Arc");
    assert.equal(res.os, "macOS");
  });

  it("detects Vivaldi browser", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Vivaldi/6.8.3381.46";
    const res = parseUserAgent(ua);
    assert.equal(res.browser, "Vivaldi");
    assert.equal(res.os, "Windows");
  });

  it("gracefully falls back on Unknown device placeholder", () => {
    const res = parseUserAgent("Unknown device");
    assert.equal(res.browser, "Unknown Browser");
    assert.equal(res.os, "Unknown OS");
  });
});
