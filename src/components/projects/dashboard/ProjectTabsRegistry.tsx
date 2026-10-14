"use client";

import dynamic from "next/dynamic";
import { SkeletonDashboard } from "@/components/projects/skeletons/SkeletonDashboard";
import { SkeletonTasks } from "@/components/projects/skeletons/SkeletonTasks";
import { SkeletonFiles } from "@/components/projects/skeletons/SkeletonFiles";
import { SkeletonSprints } from "@/components/projects/skeletons/SkeletonSprints";
import { SkeletonSettings } from "@/components/projects/skeletons/SkeletonSettings";
import { SkeletonDoc } from "@/components/projects/skeletons/SkeletonDoc";
import { SkeletonUpdates } from "@/components/projects/skeletons/SkeletonUpdates";

export const DashboardTab = dynamic(
    () => import("@/components/projects/tabs/DashboardTab"),
    { loading: () => <SkeletonDashboard />, ssr: true }
);

export const DocTab = dynamic(
    () => import("@/components/projects/tabs/DocTab"),
    { loading: () => <SkeletonDoc />, ssr: false }
);

export const UpdatesTab = dynamic(
    () => import("@/components/projects/tabs/UpdatesTab"),
    { loading: () => <SkeletonUpdates />, ssr: false }
);

export const TasksTab = dynamic(
    () => import("@/components/projects/v2/TasksTab"),
    { loading: () => <SkeletonTasks />, ssr: false }
);

// ponytail: SSR enabled with SkeletonFiles ensures initial HTML contains placeholder DOM, meeting LCP and page performance contract. ceiling: SkeletonFiles placeholder layout. upgrade: full server component data pre-hydration if initial folder query moves to RSC.
export const FilesTab = dynamic(
    () => import("@/components/projects/v2/files-tab/FilesTabRoot").then((mod) => mod.FilesTabRoot),
    { loading: () => <SkeletonFiles />, ssr: true }
);

export const SprintPlanning = dynamic(
    () => import("@/components/projects/tabs/SprintPlanning"),
    { loading: () => <SkeletonSprints />, ssr: true }
);

export const ProjectSettingsTab = dynamic(
    () => import("@/components/projects/tabs/ProjectSettingsTab"),
    { loading: () => <SkeletonSettings />, ssr: false }
);
