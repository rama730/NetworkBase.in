import { CookieSettingsButton } from "@/components/privacy/CookieSettingsButton";
import { cn } from "@/lib/utils";

// Phones: each legal link is a 44px row target (spec §09 R4).
const LINK_CLASS = "underline-offset-4 hover:text-foreground hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:justify-center";

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground max-sm:gap-x-3 max-sm:gap-y-0", className)}>
      <a className={LINK_CLASS} href="/privacy">Privacy</a>
      <a className={LINK_CLASS} href="/terms">Terms</a>
      <a className={LINK_CLASS} href="/eula">EULA</a>
      <a className={LINK_CLASS} href="/acceptable-use">Acceptable use</a>
      <a className={LINK_CLASS} href="/cookies">Cookies</a>
      <CookieSettingsButton className="max-sm:inline-flex max-sm:min-h-11 max-sm:items-center" />
      <a className={LINK_CLASS} href="/subprocessors">Providers</a>
      <a className={LINK_CLASS} href="/copyright">Copyright</a>
      <a className={LINK_CLASS} href="/grievances">Grievances</a>
      <a className={LINK_CLASS} href="/security-reporting">Security</a>
    </nav>
  );
}
