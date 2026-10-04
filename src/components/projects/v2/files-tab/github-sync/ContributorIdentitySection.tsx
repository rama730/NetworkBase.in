'use client';

import { useState } from "react";
import * as sync from "@/app/actions/github-sync";
import { button } from '@/components/projects/v2/files-tab/github-sync/sync-styles';

export function ContributorIdentitySection({
  identity,
  onApproved,
}: {
  identity?: { login: string; email: string } | null;
  onApproved: (email: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<{
    account: { login: string; [key: string]: unknown };
    emails: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(identity?.email || "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const fetchOptions = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await sync.getGitHubCommitIdentityOptions();
      if (res.success) {
        setOptions(res.data);
        if (!selectedEmail && res.data.emails[0]) {
          setSelectedEmail(res.data.emails[0]);
        }
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[6px] border border-[#DBD5C8] bg-[#FAF8F4] p-3.5 text-xs dark:border-border dark:bg-white/5 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-xs text-[#141A1E] dark:text-foreground">
            Git Commit Attribution
          </h4>
          <p className="text-[11px] text-[#6B7880] dark:text-muted-foreground mt-0.5">
            {identity
              ? `Currently configured as: ${identity.login} <${identity.email}>`
              : "Approve your verified GitHub email or privacy-safe noreply handle for commit attribution."}
          </p>
        </div>
        {!options && (
          <button
            type="button"
            className="rounded-[5px] border border-[#DBD5C8] bg-white px-3 py-1.5 text-xs font-medium text-[#374349] hover:bg-[#F3F0EA] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5 cursor-pointer transition-colors shadow-2xs"
            disabled={loading}
            onClick={() => void fetchOptions()}
          >
            {loading ? "Loading…" : identity ? "Change Email" : "Configure Email"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {options && (
        <div className="mt-3 space-y-2 border-t border-[#E8E3D9] pt-3 dark:border-border">
          <label className="block text-xs font-medium text-[#374349] dark:text-foreground">
            Select verified commit author email:
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Verified GitHub emails"
              className="min-h-9 rounded-[5px] border border-[#DBD5C8] bg-white px-2.5 py-1 text-xs text-[#141A1E] dark:border-border dark:bg-card dark:text-foreground"
              value={selectedEmail}
              onChange={(e) => setSelectedEmail(e.target.value)}
            >
              {options.emails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="min-h-9 rounded-[5px] bg-[#141A1E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#212B30] dark:bg-white dark:text-[#141A1E] dark:hover:bg-white/90 disabled:opacity-50 cursor-pointer shadow-2xs transition-colors"
              disabled={loading || !selectedEmail}
              onClick={async () => {
                setLoading(true);
                setError("");
                try {
                  await onApproved(selectedEmail);
                  setSaved(true);
                  setTimeout(() => setSaved(false), 3000);
                  setOptions(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? "Saving…" : "Save Attribution"}
            </button>
            <button
              type="button"
              className="min-h-9 rounded-[5px] border border-[#DBD5C8] bg-white px-3 py-1.5 text-xs text-[#374349] hover:bg-[#F3F0EA] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5 cursor-pointer transition-colors"
              onClick={() => setOptions(null)}
            >
              Cancel
            </button>
          </div>
          {saved && (
            <p className="text-[11px] text-[#1E7E34] font-medium">Attribution saved successfully.</p>
          )}
        </div>
      )}
    </div>
  );
}
