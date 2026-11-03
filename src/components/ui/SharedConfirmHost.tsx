"use client";

import { useSyncExternalStore } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { confirmStore } from "@/lib/ui/ask-confirm";

/** Shows whatever `askConfirm` is waiting on. Mounted once, beside the toaster. */
export function SharedConfirmHost() {
  const question = useSyncExternalStore(confirmStore.subscribe, confirmStore.current, () => null);
  return (
    <ConfirmDialog
      open={question !== null}
      onOpenChange={(open) => { if (!open) question?.answer(false); }}
      title={question?.title ?? ""}
      description={question?.description}
      confirmLabel={question?.confirmLabel}
      cancelLabel={question?.cancelLabel}
      variant={question?.destructive ? "destructive" : "default"}
      onConfirm={() => question?.answer(true)}
      autoCloseOnConfirm={false}
    />
  );
}
