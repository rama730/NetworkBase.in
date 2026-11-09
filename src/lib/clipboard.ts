import { toast } from '@/lib/feedback';

/**
 * Copy text, falling back to a selected textarea and execCommand when the Clipboard API refuses (a site setting that
 * blocks the clipboard, an unfocused document, an older browser). Inside a popup that traps focus (a menu, a dialog),
 * pass its element as `container`: a textarea outside it loses focus to the trap and copies nothing. Throws when both fail.
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
  (container ?? document.body).appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Couldn’t copy');
}

/** Acknowledge confirmed writes; a blocked clipboard retains a usable manual-copy path. */
export async function copyWithToast(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
    return true;
  } catch {
    toast.error('Couldn’t copy the link', {
      action: { label: 'Select link', onClick: () => window.dispatchEvent(new CustomEvent('nb:manual-copy', { detail: { text } })) },
    });
    return false;
  }
}
