"use client";

import type { EditorView } from "@codemirror/view";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspaceDocList } from "@/hooks/workspaces/useWorkspaceDocData";
import { liveBlockLine, newBlockKey, parseLiveBlocks } from "@/lib/workspaces/doc-live-blocks";

const ITEMS = [
  { label: "Action items", hint: "Tasks with who and when, made right here" },
  { label: "Checklist", hint: "Steps to tick off; each one is a task" },
] as const;

/**
 * Report 38.3 S5, W7: Insert ▾ in the Files editor, only for a Markdown file that is a workspace document. It writes one
 * block line with a fresh key on its own line at the cursor; Save makes a version as usual. Blocks are never typed.
 */
export function DocInsertMenu({ projectId, nodeId, view }: { projectId: string; nodeId: string; view: EditorView | null }) {
  const { data: docs = [] } = useWorkspaceDocList(projectId);
  if (!docs.some((doc) => doc.linkedNodeId === nodeId)) return null;

  function insert(label: string) {
    if (!view) return;
    const text = view.state.doc.toString();
    const key = newBlockKey(parseLiveBlocks(text).flatMap((b) => (b.key ? [b.key] : [])));
    const at = view.state.selection.main.head;
    const line = view.state.doc.lineAt(at);
    const before = line.text.trim() ? "\n" : "";
    const insertAt = line.text.trim() ? line.to : line.from;
    const block = `${before}${liveBlockLine("task_rows", key, label)}\n`;
    view.dispatch({ changes: { from: insertAt, insert: block }, selection: { anchor: insertAt + block.length } });
    view.focus();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="doc-insert-menu" className="nb-touch-target h-[28px] gap-1 rounded-[5px] px-2.5 text-xs font-medium">
          Insert <ChevronDown aria-hidden="true" className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ITEMS.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={() => insert(item.label)} className="flex flex-col items-start gap-0.5">
            <span className="text-[13px] font-medium">{item.label}</span>
            <span className="text-[11px] text-muted-foreground">{item.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
