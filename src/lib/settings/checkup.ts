// The Settings check-up and the nav's states (settings mix): what needs you, and nothing else.

export type CheckupState = {
  emailVerified: boolean;
  twoStepOn: boolean;
  recoveryCodesLeft: number;
  browserPermission: "granted" | "denied" | "default" | "unsupported";
  /** null while unknown: the item is left out rather than guessed. */
  termsAccepted: boolean | null;
};
export type CheckupItem = { id: "email" | "twostep" | "codes" | "browser" | "terms"; done: boolean };

/** Two or fewer recovery codes left is as good as none: make new ones. */
export const LOW_RECOVERY_CODES = 2;

export function checkupItems(state: CheckupState): CheckupItem[] {
  const items: CheckupItem[] = [
    { id: "email", done: state.emailVerified },
    { id: "twostep", done: state.twoStepOn },
  ];
  if (state.twoStepOn) items.push({ id: "codes", done: state.recoveryCodesLeft > LOW_RECOVERY_CODES });
  if (state.browserPermission === "denied") items.push({ id: "browser", done: false });
  if (state.termsAccepted !== null) items.push({ id: "terms", done: state.termsAccepted });
  return items;
}

export type NavState = { emailVerified: boolean; twoStepOn: boolean; recoveryCodesLeft: number; paused: boolean; deleteOn: string | null };

export function navStates(state: NavState): Partial<Record<"account" | "security" | "notifications" | "delete-account", string>> {
  const out: Partial<Record<"account" | "security" | "notifications" | "delete-account", string>> = {};
  if (!state.emailVerified) out.account = "Verify";
  if (!state.twoStepOn) out.security = "2FA off";
  else if (state.recoveryCodesLeft <= LOW_RECOVERY_CODES) out.security = "Codes";
  if (state.paused) out.notifications = "Paused";
  if (state.deleteOn) out["delete-account"] = state.deleteOn;
  return out;
}

/** The 30 squares beside Cancel deletion: whole days left until the account is removed. */
export function deletionDays(hardDeleteAt: string, now = new Date()) {
  const left = Math.max(0, Math.min(30, Math.ceil((new Date(hardDeleteAt).getTime() - now.getTime()) / 86_400_000)));
  return { left, total: 30 };
}
