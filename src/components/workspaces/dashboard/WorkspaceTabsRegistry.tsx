"use client";

import dynamic from "next/dynamic";
import { SkeletonDashboard } from "@/components/workspaces/skeletons/SkeletonDashboard";
import { SkeletonTasks } from "@/components/workspaces/skeletons/SkeletonTasks";
import { SkeletonFiles } from "@/components/workspaces/skeletons/SkeletonFiles";
import { SkeletonSprints } from "@/components/workspaces/skeletons/SkeletonSprints";
import { SkeletonSettings } from "@/components/workspaces/skeletons/SkeletonSettings";
import { SkeletonDoc } from "@/components/workspaces/skeletons/SkeletonDoc";
import { SkeletonUpdates } from "@/components/workspaces/skeletons/SkeletonUpdates";

export const DashboardTab = dynamic(
    () => import("@/components/workspaces/tabs/DashboardTab"),
    { loading: () => <SkeletonDashboard />, ssr: true }
);

export const DocTab = dynamic(
    () => import("@/components/workspaces/tabs/DocTab"),
    { loading: () => <SkeletonDoc />, ssr: false }
);

export const UpdatesTab = dynamic(
    () => import("@/components/workspaces/tabs/UpdatesTab"),
    { loading: () => <SkeletonUpdates />, ssr: false }
);

export const TasksTab = dynamic(
    () => import("@/components/workspaces/v2/TasksTab"),
    { loading: () => <SkeletonTasks />, ssr: false }
);

// ponytail: SSR enabled with SkeletonFiles ensures initial HTML contains placeholder DOM, meeting LCP and page performance contract. ceiling: SkeletonFiles placeholder layout. upgrade: full server component data pre-hydration if initial folder query moves to RSC.
export const FilesTab = dynamic(
    () => import("@/components/workspaces/v2/files-tab/FilesTabRoot").then((mod) => mod.FilesTabRoot),
    { loading: () => <SkeletonFiles />, ssr: true }
);

export const SprintPlanning = dynamic(
    () => import("@/components/workspaces/tabs/SprintPlanning"),
    { loading: () => <SkeletonSprints />, ssr: true }
);

export const ProjectSettingsTab = dynamic(
    () => import("@/components/workspaces/tabs/WorkspaceSettingsTab"),
    { loading: () => <SkeletonSettings />, ssr: false }
);
