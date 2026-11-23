"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from "react";
import * as sync from "@/app/actions/github-sync";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { button, primaryButton, quietButton } from "./sync-styles";
import styles from "./RepositorySync.module.css";

export function ContributorIdentitySection({
  identity,
  onApproved,
}: {
  identity?: { login: string; email: string } | null;
  onApproved: (email: string) => Promise<void>;
}) {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [selected, setSelected] = useState(identity?.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function fetchOptions() {
    setBusy(true);
    setError("");
    try {
      const result = await sync.getGitHubCommitIdentityOptions();
      if (!result.success) throw new Error(result.error);
      setEmails(result.data.emails);
      setSelected(
        identity?.email && result.data.emails.includes(identity.email)
          ? identity.email
          : result.data.emails[0] || "",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Verified identities could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await onApproved(selected);
      setSaved(true);
      setEmails(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Attribution could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p className={styles.muted}>
        {identity
          ? `${identity.login} <${identity.email}>`
          : "Choose your verified email or privacy-safe noreply identity. The transfer publisher is not automatically credited for every file."}
      </p>
      {error && (
        <ErrorNotice message={error} onRetry={() => void fetchOptions()} />
      )}
      {saved && (
        <p role="status" className={styles.info}>
          Commit attribution saved.
        </p>
      )}
      {emails ? (
        <div className={styles.footer}>
          <label
            className={styles.field}
            style={{ flex: "0 1 420px", maxWidth: "100%" }}
          >
            Verified commit email
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setSaved(false);
              }}
            >
              {emails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !selected}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save attribution"}
          </button>
          <button
            type="button"
            className={quietButton}
            disabled={busy}
            onClick={() => setEmails(null)}
          >
            Cancel
          </button>
          {!emails.length && (
            <p>
              No verified email is available. Check your GitHub account before
              retrying.
            </p>
          )}
        </div>
      ) : (
        <div className={styles.footer}>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void fetchOptions()}
          >
            {busy
              ? <span className="nb-waiting"><PixelBeat />Loading verified emails…</span>
              : identity
                ? "Change email"
                : "Choose verified email"}
          </button>
        </div>
      )}
    </div>
  );
}
