"use client";

import { useState } from "react";
import { Compass } from "lucide-react";

import { joinChannel } from "@/app/actions/chat/channels";
import { browseOrgProjectChannelsAction, type BrowseProjectRow } from "@/app/actions/org-chat";
import { toast } from "@/lib/feedback";

/** Browse projects (report §25.1, §25.3): org admins open any child project's channel, mentions only. */
export function OrgBrowseProjects({ orgId, onOpen, onJoined }: { orgId: string; onOpen: (channelId: string) => void; onJoined: () => void }) {
  const [rows, setRows] = useState<BrowseProjectRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = async () => {
    setOpen((v) => !v);
    if (!rows) {
      const result = await browseOrgProjectChannelsAction(orgId);
      setRows(result.success ? result.rows : []);
    }
  };
  const openProject = async (row: BrowseProjectRow) => {
    if (!row.channelId) return;
    if (!row.joined) {
      const result = await joinChannel({ channelId: row.channelId });
      if (!result.success) return void toast.error('Couldn’t open that channel');
      setRows((current) => current?.map((r) => (r.projectId === row.projectId ? { ...r, joined: true } : r)) ?? null);
      onJoined();
    }
    onOpen(row.channelId);
  };
  return (
    <div>
      <button type="button" className="nb-chat-row text-muted-foreground" aria-expanded={open} onClick={() => void toggle()}>
        <Compass size={16} aria-hidden="true" /><span className="flex-1 text-left">Browse projects{rows ? ` (${rows.length})` : ""}</span>
      </button>
      {open ? (
        rows === null ? <p className="px-2.5 py-1 text-[13px] text-muted-foreground">Loading…</p>
          : rows.length === 0 ? <p className="px-2.5 py-1 text-[13px] text-muted-foreground">No projects yet.</p>
            : rows.map((row) => (
              <button key={row.projectId} type="button" disabled={!row.channelId} className="nb-chat-row pl-8" onClick={() => void openProject(row)}>
                <span className="min-w-0 flex-1 truncate text-left">{row.title}</span>
                <span className="text-[12px] text-muted-foreground">{row.joined ? "Open" : "Join · mentions"}</span>
              </button>
            ))
      ) : null}
    </div>
  );
}
