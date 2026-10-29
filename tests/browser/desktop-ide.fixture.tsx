import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  OpenInIdeButton,
  OpenInIdeSheet,
} from "@/components/workspaces/v2/files-tab/OpenInIdeButton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import MyWorkDrawer from "@/components/my-work/MyWorkDrawer";
import { useUIStore } from "@/stores/ui-store";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.has("dark"));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const state = ((window as any).ideFixture = {
  uris: [] as string[],
  failSessions: params.has("sessions-error"),
  fallback: params.has("fallback"),
});
// Exercise the real dispatcher while preventing OS application launches in tests.
document.addEventListener(
  "click",
  (event) => {
    const anchor = (event.target as Element).closest("a");
    if (anchor && !/^https?:/.test(anchor.href)) {
      event.preventDefault();
      state.uris.push(anchor.href);
      if (!state.fallback) window.dispatchEvent(new Event("blur"));
    }
  },
  true,
);
if (params.get("surface") === "work")
  useUIStore.getState().setMyWorkOpen(true);

function Fixture() {
  const [sheet, setSheet] = useState(false);
  const button = (
    <OpenInIdeButton
      projectId="project-1"
      projectSlug="deepscope-ai"
      taskId="task-42"
      location={
        { type: "file", node: { id: "file-1", path: "/SECURITY.md" } } as any
      }
    />
  );
  return (
    <QueryClientProvider client={client}>
      <main className="min-h-dvh bg-background p-6 text-foreground">
        <header className="mb-6 flex items-center justify-between border-b border-border pb-5">
          <h1 className="text-xl font-semibold">NetworkBase</h1>
          <span className="text-sm text-muted-foreground">DeepScope AI</span>
        </header>
        <section className="rounded-lg border border-border bg-card">
          <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
            <span className="text-[13px] font-medium">
              Project files / SECURITY.md
            </span>
            {params.get("surface") === "files" && button}
          </div>
          <div className="p-6">
            <h2 className="text-xl font-semibold">Workspace security policy</h2>
            <p className="mt-4 text-sm text-muted-foreground">
              Project files, task context, and your desktop editor stay
              connected.
            </p>
          </div>
        </section>
        {params.get("surface") === "task" && (
          <Dialog open>
            <DialogContent
              showCloseButton={false}
              presentation="right-drawer"
              overlayClassName="z-[200]"
              className="z-[201] w-full gap-0 p-0 sm:max-w-[580px]"
            >
              <header className="flex items-center justify-between border-b border-border p-6">
                <DialogTitle>DSAI-42</DialogTitle>
                {params.has("mobile") ? (
                  <button onClick={() => setSheet(true)}>
                    Desktop IDE options
                  </button>
                ) : (
                  button
                )}
              </header>
              <div className="p-6">
                <h2 className="text-xl font-semibold">
                  Review workspace security controls
                </h2>
              </div>
              <OpenInIdeSheet
                layered
                open={sheet}
                onOpenChange={setSheet}
                projectId="project-1"
                taskId="task-42"
              />
            </DialogContent>
          </Dialog>
        )}
        {params.get("surface") === "work" && <MyWorkDrawer />}
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
