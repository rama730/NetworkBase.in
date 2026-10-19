import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "@/app/open/ide/route";

test("/open/ide route generates valid deep-link protocol URI and instant handoff response", async () => {
  const req = new NextRequest("https://networkbase.in/open/ide?projectId=proj-123&slug=deepscope-ai&taskId=task-456&ide=cursor");
  const response = await GET(req);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");

  const html = await response.text();
  assert.match(html, /Opening in Cursor&hellip;/);
  assert.match(html, /cursor:\/\/nb-workspace\.nb-vscode-sync\/open\?projectId=proj-123&slug=deepscope-ai&taskId=task-456/);
  assert.match(html, /Launch Cursor/);
  assert.match(html, /href="\/projects\/deepscope-ai\?tab=tasks&amp;drawerType=task&amp;drawerId=task-456"/);
  assert.match(html, /cursor:extension\/nb-workspace\.nb-vscode-sync/);
});

test("/open/ide route redirects safely when missing project context", async () => {
  const req = new NextRequest("https://networkbase.in/open/ide");
  const response = await GET(req);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://networkbase.in/discover");
});
