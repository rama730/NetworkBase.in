"use client";

import {
  AlertTriangle,
  Bell,
  Building2,
  CircleUser,
  KeyRound,
  LogOut,
  ShieldCheck,
  FolderTree,
  ChevronDown,
  FileText,
  Folder,
  Globe,
  Link2,
  Newspaper,
  Scale,
  Settings,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";
import type { ProjectSettingsSectionId } from "@/lib/workspaces/settings-policies";

export type ProjectSettingsSection = {
  id: ProjectSettingsSectionId;
  label: string;
  description: string;
};
const icons = {
  general: Settings,
  links: Link2,
  access: Globe,
  collaborators: Users,
  "roles-applications": UserCog,
  readme: FileText,
  updates: Newspaper,
  "tasks-workflow": Workflow,
  "files-workspace": Folder,
  notifications: Bell,
  "privacy-policies": Scale,
  "privacy-terms": Scale,
  danger: AlertTriangle,
  "you-membership": CircleUser,
  "you-leave": LogOut,
  "org-profile": Building2,
  "org-access": KeyRound,
  "org-people": ShieldCheck,
  "org-projects": FolderTree,
  "org-work": Workflow,
  "child-org": Building2,
};

export function ProjectSettingsNavigation({
  sections,
  activeSection,
  onNavigate,
}: {
  sections: ProjectSettingsSection[];
  activeSection: ProjectSettingsSectionId;
  onNavigate: (id: ProjectSettingsSectionId) => void;
}) {
  const links = (
    <nav aria-label="Workspace settings sections" className="flex flex-col gap-1">
      {sections.map((section) => {
        const Icon = icons[section.id];
        return (
          <a
            key={section.id}
            href={`?tab=settings&settings=${section.id}#project-settings-${section.id}`}
            aria-current={activeSection === section.id ? "page" : undefined}
            className="nb-nav-link min-w-0 focus-visible:brightness-95"
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              event.currentTarget.closest("details")?.removeAttribute("open");
              onNavigate(section.id);
            }}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 whitespace-normal break-words">
              {section.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
  return (
    <>
      <aside
        aria-label="Workspace settings navigation"
        className="sticky top-[calc(var(--project-tabs-height)+1rem)] hidden max-h-[calc(100dvh-var(--ui-topnav-height)-var(--project-tabs-height)-2rem)] self-start overflow-y-auto border-r border-border px-3 py-4 app-scroll app-scroll-y xl:block"
      >
        <div className="mb-3 space-y-3 px-2">
          <p className="nb-micro">Workspace settings</p>
          <div className="h-px bg-border" aria-hidden="true" />
        </div>
        {links}
      </aside>
      <details
        data-project-settings-selector
        className="sticky top-[var(--project-tabs-height)] z-20 border-b border-border bg-card px-4 py-2 xl:hidden"
      >
        <summary className="nb-nav-link cursor-pointer list-none justify-between">
          <span>
            {sections.find((section) => section.id === activeSection)?.label ??
              "Workspace settings"}
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </summary>
        <div className="max-h-[45dvh] overflow-y-auto pt-2">{links}</div>
      </details>
    </>
  );
}
