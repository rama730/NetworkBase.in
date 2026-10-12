import { Project } from '@/types/discover';

/** What a project card shows beyond the project itself: skills, the visible team, open seats. */
export interface ProjectCardViewModel {
    techStack: string[];
    collaborators: Array<{
        full_name?: string | null;
        avatar_url?: string | null;
        username?: string | null;
    }>;
    totalOpenRoles: number;
}

export function toProjectCardViewModel(project: Project): ProjectCardViewModel {
    const extendedProject = project as any; // Handle flexible types

    // The owner first (a masked one as a neutral "Private creator" avatar), then members, once each.
    const collaborators: ProjectCardViewModel['collaborators'] = [];
    if (extendedProject.owner?.isMasked) {
        collaborators.push({ full_name: 'Private creator', avatar_url: null, username: null });
    } else if (extendedProject.owner) {
        collaborators.push({
            full_name: extendedProject.owner.displayName || extendedProject.owner.fullName,
            avatar_url: extendedProject.owner.avatarUrl,
            username: extendedProject.owner.username,
        });
    }
    if (Array.isArray(extendedProject.collaborators)) {
        extendedProject.collaborators.forEach((collab: any) => {
            const user = collab.user || collab;
            if (user && user.id !== extendedProject.owner?.id) {
                collaborators.push({
                    full_name: user.fullName || user.displayName || user.full_name,
                    avatar_url: user.avatarUrl || user.avatar_url,
                    username: user.username,
                });
            }
        });
    }

    let totalOpenRoles = 0;
    for (const role of extendedProject.openRoles || []) {
        totalOpenRoles += Math.max(0, (role.count || 0) - (role.filled || 0));
    }
    if (totalOpenRoles === 0 && typeof extendedProject.openRolesCount === 'number' && extendedProject.openRolesCount > 0) {
        totalOpenRoles = extendedProject.openRolesCount;
    }

    return {
        techStack: extendedProject.skills || [],
        collaborators,
        totalOpenRoles,
    };
}
