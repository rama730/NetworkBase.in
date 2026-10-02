import assert from "node:assert/strict";
import test from "node:test";

import {
  importanceForKind,
} from "@/lib/notifications/classifier";
import type { NotificationKind } from "@/lib/notifications/types";

const ALL_KINDS: readonly NotificationKind[] = [
  "chat_invite",
  "application_received",
  "application_decision",
  "connection_request_received",
  "connection_request_accepted",
  "task_assigned",
  "task_status_attention",
  "task_comment_mention",
  "task_comment_reply",
  "task_file_version",
  "task_file_replaced",
  "task_file_needs_review",
  "file_version_added",
  "project_role_changed",
  "project_member_removed",
  "project_ownership_transferred",
  "project_file_permission_changed",
  "project_security_alert",
];

test("importanceForKind mirrors J1/J2 split — J1 kinds are 'important', J2 are 'more'", () => {
  assert.equal(importanceForKind("task_assigned"), "important");
  assert.equal(importanceForKind("task_comment_mention"), "important");
  assert.equal(importanceForKind("chat_invite"), "important");
  assert.equal(importanceForKind("task_file_needs_review"), "important");
  assert.equal(importanceForKind("connection_request_received"), "important");
  assert.equal(importanceForKind("project_member_removed"), "important");
  assert.equal(importanceForKind("project_ownership_transferred"), "important");

  assert.equal(importanceForKind("application_received"), "more");
  assert.equal(importanceForKind("application_decision"), "more");
  assert.equal(importanceForKind("connection_request_accepted"), "more");
  assert.equal(importanceForKind("task_status_attention"), "more");
  assert.equal(importanceForKind("task_comment_reply"), "more");
  assert.equal(importanceForKind("task_file_version"), "more");
  assert.equal(importanceForKind("task_file_replaced"), "more");
  assert.equal(importanceForKind("project_role_changed"), "more");
});
