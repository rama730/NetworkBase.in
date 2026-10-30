import type { TrustEmailData } from "@/lib/email/trust-templates";
import { caseLabel, KIND_NOUN, ruleLabel, type ModerationActionKind, type ReportTargetKind } from "@/lib/trust/rules";

// The words for every safety notice and email (docs/trust-and-safety-concept.md §9, §13). Pure, so the tray, the
// emails, the console's "Preview email" and the tests say exactly the same thing. Never names a reporter.

export const shortDate = (value: Date | string | null | undefined, timeZone?: string | null) =>
  value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: timeZone || "Asia/Kolkata" }).format(new Date(value)) : "";

export type PersonNotice = { title: string; body: string; email: TrustEmailData | null };

type DecisionInput = {
  caseNumber: number;
  action: ModerationActionKind;
  targetKind: ReportTargetKind;
  /** "a comment in Team Falcon on 29 Oct", built by the caller. */
  where: string;
  rule: number;
  message: string;
  endsAt?: Date | null;
  appealUntil?: Date | null;
  strikesActive?: number;
  workspaceTitle?: string | null;
  timeZone?: string | null;
};

const appealLinks = (caseNumber: number, appealUntil: Date | null | undefined, tz?: string | null) => appealUntil
  ? { primary: { label: "Appeal this decision", href: `/appeal/${caseLabel(caseNumber)}` }, note: `You can appeal until ${shortDate(appealUntil, tz)}.` }
  : { primary: null, note: "This decision can’t be appealed." };

const LIMIT_BULLETS = [
  "You can’t message people you aren’t connected to",
  "You can’t post or comment outside your own workspaces",
  "You can’t invite people, apply to roles, send connection requests or create workspaces",
  "You can still use your workspaces, finish your work and talk to your connections",
];

/** M1–M8: the notice and email for one decision. Org-moderator actions are tray-only (T18): pass email=false. */
export function decisionNotice(input: DecisionInput, email = true): PersonNotice {
  const label = caseLabel(input.caseNumber);
  const rule = ruleLabel(input.rule);
  const noun = KIND_NOUN[input.targetKind] ?? "content";
  const until = input.endsAt ? shortDate(input.endsAt, input.timeZone) : null;
  const appeal = appealLinks(input.caseNumber, input.appealUntil, input.timeZone);
  const base = { label: "Community rules", paragraphs: [] as string[], secondary: { label: "See your account standing", href: "/settings#settings-account-standing" } };
  const strikeLine = input.strikesActive && input.strikesActive > 1 ? `This is strike ${input.strikesActive} in 6 months. Another one may lead to a longer limit.` : null;
  let title: string;
  let data: TrustEmailData;
  switch (input.action) {
    case "hide":
    case "remove": {
      const verb = input.action === "hide" ? "hid" : "removed";
      title = `We ${verb} your ${noun} · ${rule} · ${label}`;
      data = { ...base, subject: `Your ${noun} was ${input.action === "hide" ? "hidden" : "removed"} [${label}]`, preview: `It broke ${rule}.`,
        headline: `We ${verb} your ${noun}`,
        paragraphs: [`We reviewed a report about ${input.where} and found it broke our rules, ${rule}.`, input.message, ...(strikeLine ? [strikeLine] : [])],
        primary: appeal.primary, note: appeal.note };
      break;
    }
    case "reset_profile":
    case "hold_handle": {
      title = `We changed your profile · ${rule} · ${label}`;
      data = { ...base, subject: `We changed your profile [${label}]`, preview: `It broke ${rule}.`, headline: "We changed your profile",
        paragraphs: [`We reviewed a report about your profile and found it broke our rules, ${rule}.`, input.message], primary: appeal.primary, note: appeal.note };
      break;
    }
    case "warning": {
      title = `A warning about your account · ${rule} · ${label}`;
      data = { ...base, subject: `A warning about your account [${label}]`, preview: `About ${rule}.`, headline: "A warning about your account",
        paragraphs: [`We reviewed a report about ${input.where} and found it broke our rules, ${rule}. Nothing is blocked; this is on your record for 6 months.`, input.message, "If it happens again, your account may be limited."],
        primary: appeal.primary, note: appeal.note };
      break;
    }
    case "limit": {
      title = `Your account is limited until ${until} · ${rule} · ${label}`;
      data = { ...base, subject: `Your account is limited until ${until} [${label}]`, preview: "What changes and for how long.", headline: `Your account is limited until ${until}`,
        paragraphs: [`We reviewed a report about ${input.where} and found it broke our rules, ${rule}.`, input.message, ...(strikeLine ? [strikeLine] : [])],
        bullets: LIMIT_BULLETS, primary: appeal.primary, note: appeal.note };
      break;
    }
    case "suspension": {
      title = `Your account is suspended until ${until} · ${rule} · ${label}`;
      data = { ...base, subject: `Your account is suspended [${label}]`, preview: `Until ${until}.`, headline: `Your account is suspended until ${until}`,
        paragraphs: [`We reviewed a report about ${input.where} and found it broke our rules, ${rule}.`, input.message,
          "While it lasts you can sign in only to see why, appeal and download your data."],
        primary: appeal.primary, note: appeal.note };
      break;
    }
    case "ban": {
      title = `Your account has been banned · ${rule} · ${label}`;
      data = { ...base, subject: `Your account has been banned [${label}]`, preview: "What this means.", headline: "Your account has been banned",
        paragraphs: [`We reviewed a report about ${input.where} and found it broke our rules, ${rule}.`, input.message,
          "You can sign in only to appeal and to download your data."],
        primary: appeal.primary, note: appeal.note, secondary: null };
      break;
    }
    default: {
      // M8: a workspace or org action, to its owner.
      const what = input.workspaceTitle ?? "Your workspace";
      const state = input.action === "hide_discover" ? "is hidden from Discover" : input.action === "restrict" ? "is restricted" : input.action === "suspend_workspace" ? "is suspended"
        : input.action === "remove_workspace" ? `will be deleted on ${until}` : "lost its Verified badge";
      title = `${what} ${state} · ${rule} · ${label}`;
      data = { ...base, subject: `${what} ${state} [${label}]`, preview: `It broke ${rule}.`, headline: `${what} ${state}`,
        paragraphs: [`We reviewed a report about ${what} and found it broke our rules, ${rule}.`, input.message,
          ...(input.action === "remove_workspace" ? ["It won’t be deleted while an appeal is open."] : [])],
        primary: appeal.primary, note: appeal.note };
    }
  }
  return { title, body: input.message, email: email ? data : null };
}

/** M4: the day before a limit or suspension ends. */
export function endsTomorrowNotice(action: "limit" | "suspension", endsAt: Date, tz?: string | null): PersonNotice {
  const what = action === "limit" ? "limit" : "suspension";
  return { title: `Your account ${what} ends tomorrow`, body: `It ends on ${shortDate(endsAt, tz)}.`,
    email: { subject: "Your account restriction ends tomorrow", preview: `On ${shortDate(endsAt, tz)}.`, label: "Community rules", headline: `Your account ${what} ends tomorrow`,
      paragraphs: [`Your account goes back to normal on ${shortDate(endsAt, tz)}.`], secondary: { label: "See your account standing", href: "/settings#settings-account-standing" } } };
}

/** M5: a restriction ended (on time, or lifted by staff). */
export function endedNotice(): PersonNotice {
  return { title: "Your account is back to normal", body: "Everything works again.",
    email: { subject: "Your account is back to normal", preview: "Everything works again.", label: "Community rules", headline: "Your account is back to normal",
      paragraphs: ["Your restriction has ended. Everything works as before."], secondary: { label: "See your account standing", href: "/settings#settings-account-standing" } } };
}

/** M9: appeal received. */
export function appealReceivedNotice(caseNumber: number, decideBy: Date, tz?: string | null): PersonNotice {
  const label = caseLabel(caseNumber);
  return { title: `We got your appeal · ${label}`, body: `We’ll decide by ${shortDate(decideBy, tz)}.`,
    email: { subject: `We got your appeal [${label}]`, preview: `We’ll decide by ${shortDate(decideBy, tz)}.`, label: "Appeal", headline: "We got your appeal",
      paragraphs: [`Someone on our team will look again at ${label} and decide by ${shortDate(decideBy, tz)}.`, "Your restriction stays in place while we review."],
      secondary: { label: "See your account standing", href: "/settings#settings-account-standing" } } };
}

/** M10 / M11: appeal decided. */
export function appealDecidedNotice(caseNumber: number, outcome: "upheld" | "reduced" | "reversed", reply: string): PersonNotice {
  const label = caseLabel(caseNumber);
  if (outcome === "upheld") {
    return { title: `Your appeal was reviewed · ${label}`, body: reply,
      email: { subject: `Your appeal was reviewed [${label}]`, preview: "We kept the decision.", label: "Appeal", headline: "We kept the decision",
        paragraphs: [reply, `This was your one appeal for ${label}. If you have new information, reply to this email.`], secondary: { label: "See your account standing", href: "/settings#settings-account-standing" } } };
  }
  const headline = outcome === "reversed" ? "We reversed the decision" : "We reduced the decision";
  return { title: `Good news about your appeal · ${label}`, body: reply,
    email: { subject: `Good news about your appeal [${label}]`, preview: headline + ".", label: "Appeal", headline,
      paragraphs: [reply, ...(outcome === "reversed" ? ["The strike is removed and everything is back as it was. We’re sorry for the trouble."] : [])],
      secondary: { label: "See your account standing", href: "/settings#settings-account-standing" } } };
}

/** The reporter's outcome (T5): never what happened to the other person. */
export function reporterOutcomeNotice(caseNumber: number, actioned: boolean, label: string | null) {
  const about = label ? ` about ${label.charAt(0).toLowerCase()}${label.slice(1)}` : "";
  return actioned
    ? { title: `We reviewed your report${about} and took action`, body: `${caseLabel(caseNumber)}. Thanks for helping keep NetworkBase safe.` }
    : { title: `We reviewed your report${about} and didn’t find a rule break`, body: `${caseLabel(caseNumber)}. You can block them or mute the conversation.` };
}

/** Staff alerts (T15, T24). */
export function urgentStaffEmail(caseNumber: number, reasonLabel: string, kindNoun: string, reminder = false): TrustEmailData {
  const label = caseLabel(caseNumber);
  return {
    subject: reminder ? `Still unclaimed: urgent ${label}` : `Urgent report: ${reasonLabel} · ${kindNoun} · ${label}`,
    preview: reminder ? "Nobody has started reviewing it after 30 minutes." : "Decide within 1 hour.", label: "Trust and safety",
    headline: reminder ? `${label} is still unclaimed` : `Urgent: ${reasonLabel}`,
    paragraphs: [reminder ? "Nobody has clicked I’m reviewing for 30 minutes." : `A ${kindNoun} was reported for ${reasonLabel.toLowerCase()}. The deadline is 1 hour.`],
    primary: { label: "Review now", href: `/admin/trust?case=${label}` },
  };
}

export function dailySummaryEmail(rows: { label: string; detail: string }[], counts: { open: number; urgent: number; overdue: number; appeals: number; jobsOk: boolean; failedJobs: string[] }): TrustEmailData {
  return {
    subject: `Trust and safety: ${counts.open} open, ${counts.overdue} overdue, ${counts.appeals} appeals`, preview: "Your morning summary.", label: "Trust and safety",
    headline: "Morning summary",
    paragraphs: [`${counts.open} open cases (${counts.urgent} urgent), ${counts.overdue} overdue, ${counts.appeals} appeals waiting.`,
      counts.jobsOk ? "Background checks: all ran." : `Background checks need attention: ${counts.failedJobs.join("; ")}.`],
    bullets: rows.map((r) => `${r.label}: ${r.detail}`),
    primary: { label: "Open the inbox", href: "/admin/trust" },
  };
}

export function weeklyHealthEmail(lines: string[]): TrustEmailData {
  return { subject: "Trust and safety: weekly health", preview: "How the last 7 days went.", label: "Trust and safety", headline: "Weekly health",
    paragraphs: ["The last 7 days."], bullets: lines, primary: { label: "Open health", href: "/admin/trust?tab=insights" } };
}

