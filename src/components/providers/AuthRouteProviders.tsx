'use client';

import { AuthProvider } from '@/components/providers/AuthProvider';
import { QueryProvider } from '@/components/providers/query-provider';
import { SharedConfirmHost } from '@/components/ui/SharedConfirmHost';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TooltipLayer } from '@/components/ui/TooltipLayer';
import { DragArming } from '@/components/ui/DragArming';
import type { User } from '@supabase/supabase-js';

interface AuthRouteProvidersProps {
  children: React.ReactNode;
  initialUser: User | null;
  initialProfile?: any | null;
}

export function AuthRouteProviders({ children, initialUser, initialProfile = null }: AuthRouteProvidersProps) {
  return (
    <QueryProvider>
      <TooltipProvider>
        <AuthProvider initialUser={initialUser} initialProfile={initialProfile}>
          {children}
        </AuthProvider>
        <Toaster />
        <SharedConfirmHost />
        <TooltipLayer />
        <DragArming />
      </TooltipProvider>
    </QueryProvider>
  );
}
