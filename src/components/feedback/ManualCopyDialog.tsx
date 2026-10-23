'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function ManualCopyDialog() {
  const [text, setText] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const open = (event: Event) => { const detail = (event as CustomEvent<{ text: string }>).detail; if (typeof detail?.text === 'string') setText(detail.text); };
    window.addEventListener('nb:manual-copy', open);
    return () => window.removeEventListener('nb:manual-copy', open);
  }, []);
  return <Dialog open={text !== null} onOpenChange={open => { if (!open) setText(null); }}><DialogContent onOpenAutoFocus={event => { event.preventDefault(); field.current?.focus(); field.current?.select(); }}>
    <DialogTitle>Copy manually</DialogTitle>
    <DialogDescription>Select the text below and use your device’s Copy command.</DialogDescription>
    <textarea ref={field} aria-label="Text to copy" value={text ?? ''} readOnly rows={3} className="w-full resize-none rounded-[5px] border border-input bg-card p-2 text-[13px] text-foreground" onFocus={event => event.currentTarget.select()} />
    <Button variant="outline" size="sm" onClick={() => field.current?.select()}>Select text</Button>
  </DialogContent></Dialog>;
}
