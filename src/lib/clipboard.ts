import { toast } from '@/lib/feedback';

/**
 * Copy text, falling back to a selected textarea and execCommand when the Clipboard API refuses (a site setting that
 * blocks the clipboard, an unfocused document, an older browser). Inside a popup that traps focus (a menu, a dialog)
 * the textarea goes inside it, or the trap takes its focus and nothing is copied: the popup holding focus is found by
 * itself, or pass `container`. Throws when both fail. Every copy in the app goes through here (a contract test checks).
 */
export async function copyText(value: string, container?: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Refused: fall through to the old way, which works where the API is blocked.
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  const trap = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role=dialog],[role=alertdialog],[role=menu]');
  const host = container?.isConnected ? container : trap ?? document.body;
  host.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Couldn’t copy');
}

/** Acknowledge confirmed writes; a blocked clipboard retains a usable manual-copy path. */
/** What a failed copy says, everywhere. */
export const COPY_FAILED = 'Couldn’t copy. Select it and copy it yourself.';

/** Copy, then `onCopied`; a failure says so instead of pretending it worked. */
export function copyOrSay(text: string, onCopied?: () => void) {
  void copyText(text).then(() => onCopied?.(), () => toast.error(COPY_FAILED));
}

export async function copyWithToast(text: string, done: string) {
  try {
    await copyText(text);
    toast.success(done);
    return true;
  } catch {
    toast.error('Couldn’t copy the link', {
      action: { label: 'Select link', onClick: () => window.dispatchEvent(new CustomEvent('nb:manual-copy', { detail: { text } })) },
    });
    return false;
  }
}
