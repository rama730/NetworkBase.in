"use client";

import { BarChart3, ChevronLeft, LockKeyhole, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CookieConsentPanel({
  hasDecision,
  isCustomizing,
  analyticsChoice,
  onClose,
  onCustomize,
  onBack,
  onAnalyticsChange,
  onSave,
  compact = false,
}: {
  /** Sign-in and sign-up pages: on a phone, one short line and one row of buttons, so the form stays in view. */
  compact?: boolean;
  hasDecision: boolean;
  isCustomizing: boolean;
  analyticsChoice: boolean;
  onClose: () => void;
  onCustomize: () => void;
  onBack: () => void;
  onAnalyticsChange: (value: boolean) => void;
  onSave: (analytics: boolean) => void;
}) {
  return (
    <section
      aria-describedby="cookie-consent-description"
      aria-label="Cookie settings"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-[70] w-auto rounded-lg border border-border bg-background p-5 text-foreground max-sm:inset-x-2 max-sm:bottom-2 max-sm:max-h-[40dvh] max-sm:overflow-y-auto max-sm:p-4 shadow-[0_24px_70px_rgba(15,23,42,0.22)] sm:inset-x-auto sm:right-5 sm:w-[26rem] dark:shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
      role="dialog"
    >
      {hasDecision ? (
        <button
          type="button"
          aria-label="Close cookie settings"
          className="nb-touch-target absolute right-4 top-4 inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground max-sm:right-2 max-sm:top-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      {isCustomizing ? (
        <CookiePreferenceEditor
          analyticsChoice={analyticsChoice}
          onAnalyticsChange={onAnalyticsChange}
          onBack={onBack}
          onSave={() => onSave(analyticsChoice)}
        />
      ) : (
        <CookieConsentSummary
          compact={compact}
          onAcceptAll={() => onSave(true)}
          onCustomize={onCustomize}
          onRejectOptional={() => onSave(false)}
        />
      )}
    </section>
  );
}

function CookieConsentSummary({
  compact,
  onAcceptAll,
  onCustomize,
  onRejectOptional,
}: {
  compact: boolean;
  onAcceptAll: () => void;
  onCustomize: () => void;
  onRejectOptional: () => void;
}) {
  return (
    <>
      {compact ? (
        <p className="pr-8 text-[13px] leading-5 text-muted-foreground sm:hidden">
          Cookies keep you signed in. Analytics only if you allow it.{" "}
          <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={onCustomize}>Choose</button>
        </p>
      ) : null}
      <h2 className={`pr-8 text-lg font-semibold tracking-tight max-sm:text-[17px] ${compact ? "max-sm:hidden" : ""}`}>Cookie settings</h2>
      <p id="cookie-consent-description" className={`${compact ? "max-sm:sr-only " : ""}mt-3 text-sm leading-6 text-muted-foreground max-sm:mt-1.5 max-sm:text-[13px] max-sm:leading-5`}>
        We use essential cookies to secure your account and provide NetworkBase. With your permission, we also use analytics to understand and improve the service. Read our{" "}
        <a href="/cookies" className="font-medium text-foreground underline underline-offset-4">
          Cookie Notice
        </a>
        .
      </p>

      {/* Phones: tighter spacing and a quieter Customize row keep the banner near a third of the screen (§31 mobile fit). */}
      <div className="mt-5 grid gap-2.5 max-sm:mt-3 max-sm:gap-2">
        <Button type="button" variant="secondary" className={`h-11 w-full max-sm:h-10 ${compact ? "max-sm:hidden " : ""}max-sm:bg-transparent max-sm:underline max-sm:underline-offset-4`} onClick={onCustomize}>
          Customize cookie settings
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" className="h-11 w-full" onClick={onRejectOptional}>
            Reject optional
          </Button>
          <Button type="button" className="h-11 w-full" onClick={onAcceptAll}>
            Accept all
          </Button>
        </div>
      </div>
    </>
  );
}

function CookiePreferenceEditor({
  analyticsChoice,
  onAnalyticsChange,
  onBack,
  onSave,
}: {
  analyticsChoice: boolean;
  onAnalyticsChange: (value: boolean) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>
      <h2 className="pr-8 text-lg font-semibold tracking-tight">Choose what NetworkBase can use</h2>
      <p id="cookie-consent-description" className="mt-2 text-sm leading-6 text-muted-foreground">
        Essential storage is always active. Analytics remains off unless you allow it.
      </p>

      <div className="mt-5 space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-border p-3.5">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Essential</h3>
              <span className="text-xs font-medium text-muted-foreground">Always active</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Required for authentication, security, legal choices, and requested preferences.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border p-3.5">
          <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Analytics</h3>
              <button
                type="button"
                role="switch"
                aria-checked={analyticsChoice}
                aria-label="Allow analytics cookies"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  analyticsChoice ? "border-primary bg-primary" : "border-border bg-muted"
                }`}
                onClick={() => onAnalyticsChange(!analyticsChoice)}
              >
                <span
                  className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-background shadow-none transition-transform ${
                    analyticsChoice ? "translate-x-[1.25rem]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Helps us measure usage and reliability so we can improve the product.
            </p>
          </div>
        </div>
      </div>

      <Button type="button" className="mt-5 h-11 w-full" onClick={onSave}>
        Save choices
      </Button>
    </>
  );
}
