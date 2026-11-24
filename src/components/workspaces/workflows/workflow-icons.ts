import { catalogEntry } from "@/lib/workflows/catalog";
import type { AddedWorkflow } from "@/lib/workflows/rules";
import { Bug, CalendarClock, ChartGantt, FolderKanban, Images, Inbox, Lightbulb, Map, Megaphone, PenLine, Rocket, Route, Target, Tent, Workflow, type IconComponent } from "@/components/ui/icons";

// The catalog names its icons (src/lib/workflows/catalog.ts); explicit imports keep the bundle to these.
const ICONS: Record<string, IconComponent> = { Bug, CalendarClock, ChartGantt, FolderKanban, Images, Inbox, Lightbulb, Map, Megaphone, PenLine, Rocket, Route, Target, Tent };

export const workflowIcon = (name: string): IconComponent => ICONS[name] ?? Workflow;

/** Report 38.2 S1: the tab row's own tabs from the added workflows, in catalog order. */
export const workflowTabsFor = (added: AddedWorkflow[]) => added.flatMap((w) => {
  const entry = catalogEntry(w.workflow);
  return entry?.tab ? [{ id: entry.tab, label: entry.name, icon: workflowIcon(entry.icon), locked: w.locked, by: w.by }] : [];
});
