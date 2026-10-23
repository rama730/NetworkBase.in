import { toast } from '@/lib/feedback';

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
