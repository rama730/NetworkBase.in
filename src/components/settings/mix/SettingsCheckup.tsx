"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PixelIcon } from "@/components/auth/pixel";
import { Button } from "@/components/ui/button";
import { feedbackError, toast } from "@/lib/feedback";
import { LOW_RECOVERY_CODES, type CheckupItem } from "@/lib/settings/checkup";
import { formatCalendarDate } from "@/lib/ui/date-formatting";
import { cn } from "@/lib/utils";
import { jumpToSetting, openSetting } from "./jump";
import { useSettingsSummary } from "./useSettingsSummary";

/** Ask for the verification email again (same route as the verify page; one a minute). */
export function useSendVerification() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const send = async () => {
    setState("sending");
    try {
      const response = await fetch("/api/v1/auth/verify-email", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.message || "Couldn’t send the link");
      setState("sent");
    } catch (error) {
      setState("idle");
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t send the link"));
    }
  };
  return { state, send };
}

/** The check-up under the band (mix v2): what needs you, each with its action; gone once everything is done. */
export function SettingsCheckup() {
  const summary = useSettingsSummary();
  const verify = useSendVerification();
  const items = summary.checkup;
  const done = items.filter((item) => item.done).length;
  const allDone = items.length > 0 && done === items.length;
  // "All set" shows only when the last item gets done while the page is open, then fades.
  const hadWork = useRef(false);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (items.length && !allDone) hadWork.current = true;
    if (allDone && hadWork.current) {
      hadWork.current = false;
      setJustDone(true);
      const timer = window.setTimeout(() => setJustDone(false), 3200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [allDone, items.length]);

  if (!items.length) return null;
  if (allDone) return justDone ? <section className="nbs-checkup" aria-live="polite"><div className="nbs-allset"><PixelIcon name="check" />All set · nothing needs you</div></section> : null;

  const left = items.length - done;
  const copy = (item: CheckupItem): { t: string; d: string; act?: ReactNode } => {
    switch (item.id) {
      case "email":
        return { t: "Verify your email", d: verify.state === "sent" ? "Link sent. Open it from your inbox, then come back." : "So security emails and sign-in links reach you.",
          act: verify.state === "sent" ? <span className="nbs-meta">Sent · check your inbox</span> : <Button type="button" variant="outline" size="sm" pending={verify.state === "sending"} onClick={() => void verify.send()}>Send link</Button> };
      case "twostep":
        return { t: "Turn on two-step verification", d: "A code from your phone at each sign-in.", act: <Button type="button" size="sm" onClick={() => openSetting("settings-security-twostep", "twostep-setup")}>Set up</Button> };
      case "codes":
        return { t: summary.recoveryCodesLeft > 0 ? "Make new recovery codes" : "Save your recovery codes", d: summary.recoveryCodesLeft > 0 && summary.recoveryCodesLeft <= LOW_RECOVERY_CODES ? `Only ${summary.recoveryCodesLeft} left. You’ll need one if you lose your phone.` : "You’ll need one if you lose your phone.", act: <Button type="button" variant="outline" size="sm" onClick={() => jumpToSetting("settings-security-codes")}>Show codes</Button> };
      case "browser":
        return { t: "Browser notifications are blocked", d: "Allow them in your browser’s site settings to get alerts here.", act: <Button type="button" variant="outline" size="sm" onClick={() => jumpToSetting("settings-notifications-browser")}>Show me</Button> };
      case "terms":
        return { t: "Accept the current terms", d: item.done ? (summary.legal?.latest?.acceptedAt ? `Accepted ${formatCalendarDate(summary.legal.latest.acceptedAt)}.` : "Accepted.") : "The terms changed since you last accepted them.", act: <Button type="button" variant="outline" size="sm" onClick={() => jumpToSetting("settings-privacy-policies-terms")}>Review</Button> };
    }
  };

  return (
    <section className="nbs-checkup" id="settings-checkup" aria-labelledby="settings-checkup-h">
      <div className="nbs-ck-head">
        <p className="nbs-eyebrow">Check-up</p>
        <h2 id="settings-checkup-h">{left} {left === 1 ? "thing needs" : "things need"} you.</h2>
        <span className="nbs-squares" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < Math.round((done / items.length) * 5) ? "on" : undefined} />)}</span>
        <span className="nbs-meta">{done} of {items.length} done</span>
      </div>
      {[...items].sort((a, b) => Number(a.done) - Number(b.done)).map((item) => {
        const { t, d, act } = copy(item);
        return (
          <div key={item.id} className={cn("nbs-ck", item.done && "done")} data-ck={item.id}>
            <span className="box" aria-hidden="true">{item.done ? <PixelIcon name="check" /> : null}</span>
            <div><div className="t">{t}{item.done ? <span className="sr-only"> (done)</span> : null}</div><div className="d">{d}</div></div>
            <div>{item.done ? null : act}</div>
          </div>
        );
      })}
    </section>
  );
}
