"use client";

import Link from "next/link";
import { Check, House, Plus } from "lucide-react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { initials, projectsByActivity, railBadges } from "@/lib/messaging/channel-view";

/** Mobile and "Switch project": Home, each project with its badge, New project (D14). In-memory only. */
export function ProjectSwitcherSheet() {
  const open = useChatUi((state) => state.projectSheetOpen);
  const setOpen = useChatUi((state) => state.setProjectSheetOpen);
  const setProject = useChatUi((state) => state.setProject);
  const selected = useSelectedProject();
  const { data } = useChatShell();
  const badges = railBadges(data);
  const choose = (projectId: string | null) => {
    setProject(projectId);
    setOpen(false);
  };
  const row = (id: string | null, label: string, icon: React.ReactNode) => {
    const count = badges.get(id) ?? 0;
    return (
      <button key={id ?? "home"} type="button" onClick={() => choose(id)} className="flex min-h-11 w-full items-center gap-3 rounded-[5px] px-3 text-left text-[15px] hover:bg-muted" aria-current={selected === id ? "true" : undefined}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
        {selected === id ? <Check size={16} aria-label="Selected" /> : null}
      </button>
    );
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent presentation="bottom-sheet" showCloseButton={false} className="sm:mx-auto sm:max-w-md">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        <DialogTitle className="px-4 pb-1 pt-3 text-[17px]">Switch project</DialogTitle>
        <div className="overflow-y-auto px-2 pb-3">
          {row(null, "Home", <House size={18} aria-hidden="true" />)}
          {projectsByActivity(data).map((project) =>
            row(project.id, project.title, <span className="grid size-7 place-items-center rounded-[5px] bg-secondary text-[12px] font-semibold">{initials(project.title)}</span>),
          )}
          <Link href="/projects/new" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-[5px] px-3 text-[15px] hover:bg-muted">
            <Plus size={18} aria-hidden="true" /> New project
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
