import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Webhook } from "svix";
import {
  assignmentRecipient, buildEmail, emailEnabled, emailEventKey, eventDeliveryState,
  MAX_ATTEMPTS, parseResendEvent, recipientAllowed, RETRY_WINDOW_MS, retryDecision,
  suppressionReason, verifyResendEvent,
} from "@/lib/email/contracts";

const original = { ...process.env };
afterEach(() => {
  for (const name of ["NODE_ENV", "RAILWAY_ENVIRONMENT_NAME", "RESEND_EMAIL_ENABLED", "RESEND_TEST_RECIPIENTS", "APP_URL"]) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

test("mail defaults off; preview production builds still require an explicit allowlist", () => {
  delete process.env.RESEND_EMAIL_ENABLED;
  assert.equal(emailEnabled(), false);
  process.env.RESEND_EMAIL_ENABLED = "true";
  assert.equal(emailEnabled(), true);
  (process.env as Record<string, string>).NODE_ENV = "production";
  process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
  delete process.env.RESEND_TEST_RECIPIENTS;
  assert.equal(recipientAllowed("allowed@example.com"), false);
  process.env.RESEND_TEST_RECIPIENTS = " ALLOWED@example.com, second@example.com ";
  assert.equal(recipientAllowed("allowed@example.com"), true);
  assert.equal(recipientAllowed("other@example.com"), false);
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  assert.equal(recipientAllowed("other@example.com"), true);
});

test("only another user's new assignment qualifies; A→B→A has distinct durable identities", () => {
  assert.equal(assignmentRecipient("actor", "a"), "a");
  assert.equal(assignmentRecipient("actor", "a", "b"), "a");
  assert.equal(assignmentRecipient("actor", "actor", "a"), null);
  assert.equal(assignmentRecipient("actor", "a", "a"), null);
  assert.equal(assignmentRecipient("actor", null, "a"), null);
  assert.notEqual(emailEventKey("task_assignment", "activity-1", "a"), emailEventKey("task_assignment", "activity-3", "a"));
  assert.equal(emailEventKey("welcome", "a", "a"), emailEventKey("welcome", "a", "a"));
});

test("two small branded multipart templates escape dynamic content and use the trusted URL", () => {
  process.env.APP_URL = "https://networkbase.in";
  const welcome = buildEmail({ kind: "welcome", email: "ada@example.com", name: '<Ada & "Team">' });
  assert.equal(welcome.from, "NetworkBase <welcome@networkbase.in>");
  assert.equal(welcome.reply_to, "support@networkbase.in");
  assert.match(welcome.html, /&lt;Ada &amp; &quot;Team&quot;&gt;/);
  assert.doesNotMatch(welcome.html, /<Ada/);
  assert.match(welcome.html, /lang="en"/);
  assert.match(welcome.text, /https:\/\/networkbase\.in\/discover/);
  const task = buildEmail({ kind: "task_assignment", email: "ada@example.com", name: "Ada", taskTitle: "<script>\r\nDeploy & test", projectTitle: "Private & team", taskId: "task/1", projectSlug: "project/1" });
  assert.equal(task.from, "NetworkBase <notifications@networkbase.in>");
  assert.doesNotMatch(task.subject, /[\r\n]/);
  assert.doesNotMatch(task.html, /<script>/);
  assert.match(task.html, /&lt;script&gt;/);
  assert.match(task.text, /projects\/project%2F1\?tab=tasks&drawerType=task&drawerId=task%2F1/);
  assert.match(task.text, /settings#settings-notifications/);
  assert.throws(() => buildEmail({ kind: "task_assignment", email: "ada@example.com", name: "Ada" }), /Missing task/);
});

test("bounded retries honor numeric/date Retry-After and stop before the 24-hour dedupe expiry", () => {
  const first = new Date("2026-10-07T00:00:00Z");
  assert.equal(retryDecision(1, first, first)?.getTime(), first.getTime() + 30_000);
  assert.equal(retryDecision(2, first, first)?.getTime(), first.getTime() + 60_000);
  assert.equal(retryDecision(1, first, first, "120")?.getTime(), first.getTime() + 120_000);
  const retryAt = new Date(first.getTime() + 180_000);
  assert.equal(retryDecision(1, first, first, retryAt.toUTCString())?.getTime(), retryAt.getTime());
  assert.equal(retryDecision(MAX_ATTEMPTS, first, first), null);
  assert.equal(retryDecision(1, first, new Date(first.getTime() + RETRY_WINDOW_MS)), null);
  assert.equal(retryDecision(1, first, first, "86400"), null);
  assert.ok(retryDecision(1, first, first, "invalid"));
});

const event = {
  type: "email.bounced", created_at: "2026-10-07T00:00:00Z",
  data: { email_id: "de708ccd-1a1b-4a23-9810-67ac20d55133", to: ["ada@example.com"], bounce: { type: "Permanent" } },
};

test("official Svix verification uses the raw payload, rejects tampering and stale/invalid signatures", () => {
  const secret = `whsec_${Buffer.from("isolated-test-secret-no-live-credentials").toString("base64")}`;
  const raw = JSON.stringify(event);
  const now = new Date();
  const id = "msg_test_delivery";
  const signer = new Webhook(secret);
  const headers = { "svix-id": id, "svix-timestamp": String(Math.floor(now.getTime() / 1000)), "svix-signature": signer.sign(id, now, raw) };
  assert.deepEqual(verifyResendEvent(raw, headers, secret), event);
  assert.throws(() => verifyResendEvent(`${raw} `, headers, secret));
  assert.throws(() => verifyResendEvent(raw, { ...headers, "svix-signature": "v1,bad" }, secret));
  const old = new Date(now.getTime() - 10 * 60_000);
  assert.throws(() => verifyResendEvent(raw, { ...headers, "svix-timestamp": String(Math.floor(old.getTime() / 1000)), "svix-signature": signer.sign(id, old, raw) }, secret));
});

test("hard bounce and complaint suppress future emails; a transient bounce does not", () => {
  const parsed = parseResendEvent(event);
  assert.ok(parsed.success);
  assert.equal(eventDeliveryState(parsed.data), "bounced");
  assert.equal(suppressionReason(parsed.data), "hard_bounce");
  assert.equal(suppressionReason({ ...parsed.data, data: { ...parsed.data.data, bounce: { type: "Transient" } } }), null);
  assert.equal(suppressionReason({ ...parsed.data, type: "email.complained" }), "complaint");
  assert.equal(eventDeliveryState({ ...parsed.data, type: "email.sent" }), "accepted");
  assert.equal(parseResendEvent({ ...event, data: { ...event.data, email_id: "invalid" } }).success, false);
});

test("redesigned task email renders open layout, Ponytail avatar, subtasks and file references", () => {
  process.env.APP_URL = "https://networkbase.in";

  // Case A: With Supabase storage avatar and subtasks with files
  const emailA = buildEmail({
    kind: "task_assignment",
    email: "recipient@example.com",
    name: "Supervisor",
    taskTitle: "Conduct end-to-end testing on core floors",
    projectTitle: "DeepScope AI",
    taskId: "task-101",
    projectSlug: "deepscope-ai",
    taskNumber: 42,
    priority: "high",
    status: "in_progress",
    dueDate: "2026-10-14T00:00:00Z",
    assigneeName: "Rama Rao",
    assigneeUsername: "ramarao",
    assigneeAvatarUrl: "https://example.supabase.co/storage/v1/object/public/avatars/user_123.jpg",
    assigneeHeadline: "Lead Quality Engineer",
    assignerName: "Alex Chen",
    assignerUsername: "alexchen",
    connectedDesktopIde: {
      name: "Cursor",
      scheme: "cursor",
      launchUrl: "https://networkbase.in/open/ide?projectId=deepscope-ai&slug=deepscope-ai&taskId=task-101&ide=cursor",
    },
    subtasks: [
      {
        id: "st-1",
        title: "Calibration check for Level 1 sensors",
        completed: true,
        files: [{ name: "sensor_specs_v2.pdf", size: 1258291, url: "https://networkbase.in/files/1" }],
      },
      {
        id: "st-2",
        title: "Core stress test sequence under load",
        completed: false,
        files: [{ name: "stress_test_matrix.xlsx", size: 430080 }],
      },
    ],
    files: [
      { id: "f-1", name: "floor_topology.dwg", size: 5033164 },
    ],
  });

  // Verify breadcrumb & header with canonical squircle brand mark and clickable project name
  assert.match(emailA.html, /NetworkBase/);
  assert.match(emailA.html, /DeepScope AI/);
  assert.match(emailA.html, /href="https:\/\/networkbase\.in\/projects\/deepscope-ai"/);
  assert.match(emailA.html, /width:7px;height:7px;border-radius:2px;background-color:#C24720;/);
  assert.doesNotMatch(emailA.html, /●/);
  assert.match(emailA.text, /Workspace: DeepScope AI/);

  // Verify left-edge alignment and responsive container padding
  assert.match(emailA.html, /<td class="container-cell" align="left" style="padding:28px 20px;text-align:left;">/);
  assert.match(emailA.html, /table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="left"/);

  // Verify assignee is Rama Rao (account profile picture), decoupled from recipient Supervisor
  assert.match(emailA.html, /Assigned to/);
  assert.match(emailA.html, /Rama Rao/);
  assert.match(emailA.html, /@ramarao/);
  assert.match(emailA.html, /Lead Quality Engineer/);
  assert.match(emailA.html, /Assigned by/);
  assert.match(emailA.html, /Alex Chen/);
  assert.match(emailA.text, /Assigned to: Rama Rao \(@ramarao\) • Lead Quality Engineer/);
  assert.match(emailA.text, /Assigned by Alex Chen \(@alexchen\)/);

  // Verify Ponytail avatar rendered directly without MIME attachment (zero paperclip icons)
  assert.equal(emailA.attachments, undefined);
  assert.match(emailA.html, /<img src="https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/avatars\/user_123\.jpg"/);
  assert.match(emailA.html, /width:44px;height:44px;border-radius:6px/);
  assert.doesNotMatch(emailA.html, /width:44px;height:44px;border-radius:50%/);

  // Verify RFC 8058 one-click unsubscribe headers
  assert.ok(emailA.headers?.["List-Unsubscribe"]);
  // No one-click header: nothing accepts a POST that unsubscribes, so claiming it would send mail apps to a page.
  assert.equal(emailA.headers?.["List-Unsubscribe-Post"], undefined);

  // Verify dual-title preheader and deep ghost spacing for left inbox preview list
  assert.match(emailA.subject, /Task assigned: Conduct end-to-end testing on core floors/);
  assert.match(emailA.html, /Conduct end-to-end testing on core floors — High priority • In progress • (Overdue|Due in \d+ days|Due today) \(Oct 14, 2026\) • in DeepScope AI • assigned to Rama Rao • 1 of 2 subtasks completed/);
  assert.match(emailA.html, /&zwnj;&nbsp;/);

  // Verify task title & metadata pills
  assert.match(emailA.html, /Conduct end-to-end testing on core floors/);
  assert.match(emailA.html, /NB-42/);
  assert.match(emailA.html, /High priority/);
  assert.match(emailA.html, /In progress/);
  assert.match(emailA.html, /Oct 14, 2026/);

  // Verify Subtasks & Scope
  assert.match(emailA.html, /Subtasks and Scope/);
  assert.match(emailA.html, /1 of 2 completed/);
  assert.match(emailA.html, /Calibration check for Level 1 sensors/);
  assert.match(emailA.html, /Core stress test sequence under load/);
  assert.match(emailA.html, /sensor_specs_v2\.pdf/);
  assert.match(emailA.html, /1\.2 MB/);
  assert.match(emailA.html, /stress_test_matrix\.xlsx/);
  assert.match(emailA.html, /420 KB/);

  // Verify referenced files section
  assert.match(emailA.html, /Referenced Files and Assets/);
  assert.match(emailA.html, /floor_topology\.dwg/);
  assert.match(emailA.html, /4\.8 MB/);

  // Verify Action Bar (Lightweight, Non-heavy Button Group: Task View, Project Name, and Code editor)
  assert.match(emailA.html, /View Task &rarr;/);
  assert.match(emailA.html, /DeepScope AI &#8599;/);
  assert.match(emailA.html, /Open in Cursor &#8599;/);
  assert.match(emailA.text, /View Task: https:\/\/networkbase\.in\/projects\/deepscope-ai\?tab=tasks&drawerType=task&drawerId=task-101/);
  assert.match(emailA.text, /Workspace: https:\/\/networkbase\.in\/projects\/deepscope-ai/);
  assert.match(emailA.text, /Open in Cursor: https:\/\/networkbase\.in\/open\/ide\?projectId=deepscope-ai&slug=deepscope-ai&taskId=task-101&ide=cursor/);

  // Verify Footer links: Contact Support, Privacy, Security, Terms and Conditions
  assert.match(emailA.html, /Contact Support/);
  assert.match(emailA.html, /href="mailto:support@networkbase\.in"/);
  assert.match(emailA.html, /https:\/\/networkbase\.in\/privacy/);
  assert.match(emailA.html, /https:\/\/networkbase\.in\/security-reporting/);
  assert.match(emailA.html, /https:\/\/networkbase\.in\/terms/);
  assert.match(emailA.html, /Manage notification preferences/);
  assert.match(emailA.html, /&copy; NetworkBase/);
  assert.match(emailA.text, /Contact Support: mailto:support@networkbase\.in/);
  assert.match(emailA.text, /Privacy: https:\/\/networkbase\.in\/privacy/);
  assert.match(emailA.text, /Security: https:\/\/networkbase\.in\/security-reporting/);
  assert.match(emailA.text, /Terms and Conditions: https:\/\/networkbase\.in\/terms/);

  // Case B: Without avatar image (fallback to Ponytail deterministic tone and initials)
  const emailB = buildEmail({
    kind: "task_assignment",
    email: "b@example.com",
    name: "Alex Chen",
    taskTitle: "Security audit",
    projectTitle: "Platform",
    taskId: "task-2",
    projectSlug: "platform",
    assigneeName: "Alex Chen",
  });
  // Ponytail initials AC rendered in square container
  assert.match(emailB.html, />AC<\/td>/);
  assert.doesNotMatch(emailB.html, /<img/);
  assert.match(emailB.html, /border-radius:6px/);
  assert.doesNotMatch(emailB.html, /border-radius:50%/);

  // Case C: With connectedDesktopIde provided without launchUrl (auto-computes trampoline URL)
  const emailC = buildEmail({
    kind: "task_assignment",
    email: "c@example.com",
    name: "Alex",
    taskTitle: "Bug triage",
    projectTitle: "Core",
    taskId: "task-3",
    projectSlug: "core",
    connectedDesktopIde: {
      name: "VS Code",
      scheme: "vscode",
    },
  });
  assert.match(emailC.html, /Open in VS Code &#8599;/);
  assert.match(emailC.html, /href="https:\/\/networkbase\.in\/open\/ide\?projectId=core&amp;slug=core&amp;taskId=task-3&amp;ide=vscode"/);
  assert.match(emailC.text, /Open in VS Code: https:\/\/networkbase\.in\/open\/ide\?projectId=core&slug=core&taskId=task-3&ide=vscode/);
});

test("redesigned welcome email renders Ponytail avatar, profile identity, skills, and responsive action bar", () => {
  process.env.APP_URL = "https://networkbase.in";

  const welcomeWithAvatar = buildEmail({
    kind: "welcome",
    email: "sarah@example.com",
    name: "Sarah Connor",
    username: "sconnor",
    avatarUrl: "https://example.supabase.co/storage/v1/object/public/avatars/sarah.jpg",
    headline: "Autonomous Systems Lead",
    skills: ["TypeScript", "Next.js", "Distributed Systems"],
    userId: "usr-42",
  });

  // Verify sender & RFC 8058 headers
  assert.equal(welcomeWithAvatar.from, "NetworkBase <welcome@networkbase.in>");
  assert.equal(welcomeWithAvatar.reply_to, "support@networkbase.in");
  assert.equal(welcomeWithAvatar.subject, "Welcome to NetworkBase, Sarah Connor");
  assert.equal(welcomeWithAvatar.headers?.["List-Unsubscribe-Post"], undefined);
  assert.match(welcomeWithAvatar.headers?.["List-Unsubscribe"] || "", /settings#settings-notifications/);

  // Zero MIME attachments (no paperclip bug in Apple Mail)
  assert.equal(welcomeWithAvatar.attachments, undefined);

  // Ponytail avatar rendered directly
  assert.match(welcomeWithAvatar.html, /<img src="https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/avatars\/sarah\.jpg"/);
  assert.match(welcomeWithAvatar.html, /width:44px;height:44px;border-radius:6px/);
  assert.match(welcomeWithAvatar.html, /Member profile/);
  assert.match(welcomeWithAvatar.html, /Sarah Connor/);
  assert.match(welcomeWithAvatar.html, /@sconnor/);
  assert.match(welcomeWithAvatar.html, /Autonomous Systems Lead/);

  // Ghost preheader & dark mode
  assert.match(welcomeWithAvatar.html, /&zwnj;&nbsp;/);
  assert.match(welcomeWithAvatar.html, /color-scheme/);

  // Skills rendered as clean pills
  assert.match(welcomeWithAvatar.html, /Focus and Skills/);
  assert.match(welcomeWithAvatar.html, /TypeScript/);
  assert.match(welcomeWithAvatar.html, /Distributed Systems/);

  // Action bar buttons
  assert.match(welcomeWithAvatar.html, /Explore workspaces &rarr;/);
  assert.match(welcomeWithAvatar.html, /View Your Profile &#8599;/);
  assert.match(welcomeWithAvatar.html, /href="https:\/\/networkbase\.in\/sconnor"/);

  // Legal footer
  assert.match(welcomeWithAvatar.html, /Contact Support/);
  assert.match(welcomeWithAvatar.html, /Privacy/);
  assert.match(welcomeWithAvatar.html, /Security/);
  assert.match(welcomeWithAvatar.html, /Terms and Conditions/);
  assert.match(welcomeWithAvatar.html, /&copy; NetworkBase/);

  // Plain text fallback
  assert.match(welcomeWithAvatar.text, /Welcome to NetworkBase, Sarah Connor!/);
  assert.match(welcomeWithAvatar.text, /@sconnor/);
  assert.match(welcomeWithAvatar.text, /Autonomous Systems Lead/);
  assert.match(welcomeWithAvatar.text, /Focus and Skills: TypeScript, Next.js, Distributed Systems/);
  assert.match(welcomeWithAvatar.text, /https:\/\/networkbase\.in\/discover/);
  assert.match(welcomeWithAvatar.text, /https:\/\/networkbase\.in\/sconnor/);

  // Case with initials fallback (no avatar URL)
  const welcomeInitials = buildEmail({
    kind: "welcome",
    email: "dev@example.com",
    name: "Alex Dev",
    username: "alexdev",
  });
  assert.match(welcomeInitials.html, />AD<\/td>/);
  assert.doesNotMatch(welcomeInitials.html, /<img/);
  assert.match(welcomeInitials.html, /border-radius:6px/);
});

