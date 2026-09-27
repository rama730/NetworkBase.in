'use client';

import { UserAvatar } from '@/components/ui/UserAvatar';

interface AvatarEntry {
    url: string | null;
    initials: string;
    name?: string | null;
}

interface StackedAvatarsProps {
    avatars: AvatarEntry[];
    max?: number;
    size?: number;
}

export function StackedAvatars({ avatars, max = 3, size = 26 }: StackedAvatarsProps) {
    const visible = avatars.slice(0, max);
    const overflow = avatars.length - visible.length;

    return (
        <div className="flex items-center">
            {visible.map((avatar, index) => (
                <UserAvatar
                    key={`stacked-avatar-${index}`}
                    identity={{
                        avatarUrl: avatar.url,
                        fullName: avatar.name ?? avatar.initials,
                        username: avatar.name ?? avatar.initials,
                    }}
                    size={size}
                    className="border-2 border-white dark:border-zinc-950"
                    fallbackDisplayName={avatar.name ?? avatar.initials}
                    fallbackInitials={avatar.initials}
                    fallbackClassName="text-[11px] font-medium text-white"
                    style={{ marginLeft: index > 0 ? -6 : 0, zIndex: visible.length - index }}
                />
            ))}
            {overflow > 0 && (
                <div
                    className="flex shrink-0 items-center justify-center rounded-md border-2 border-card bg-secondary text-secondary-foreground"
                    style={{ width: size, height: size, marginLeft: -6, zIndex: 0 }}
                >
                    <span className="font-mono text-[11px] font-semibold">+{overflow}</span>
                </div>
            )}
        </div>
    );
}
