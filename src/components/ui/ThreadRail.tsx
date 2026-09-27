"use client";

import React from "react";

export interface ThreadAvatarRailProps {
  children: React.ReactNode;
  incoming: boolean;
  outgoing: boolean;
}

/**
 * ThreadAvatarRail renders continuous geometric vertical connecting rails
 * above (incoming) and below (outgoing) the avatar container, establishing a
 * solid drafting-table visual timeline.
 */
export function ThreadAvatarRail({
  children,
  incoming,
  outgoing,
}: ThreadAvatarRailProps) {
  return (
    <div className="relative flex w-8 shrink-0 self-stretch justify-center py-0.5">
      {incoming ? (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-border"
        />
      ) : null}
      {outgoing ? (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 top-[34px] w-px -translate-x-1/2 bg-border"
        />
      ) : null}
      <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-[5px] ring-2 ring-background bg-card">
        {children}
      </div>
    </div>
  );
}

/**
 * ThreadRailBridge renders a continuous vertical connecting line through a
 * collapsed or intermediary spacer node with a drafting micro-point.
 */
export function ThreadRailBridge() {
  return (
    <div
      className="relative flex h-8 w-8 shrink-0 flex-col items-center justify-center"
      aria-hidden="true"
    >
      {/* Continuous vertical connecting line */}
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      {/* Geometric drafting node */}
      <span className="relative z-10 size-1 rounded-[1px] bg-muted-foreground/50 ring-2 ring-background" />
    </div>
  );
}
