import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
    return updateSession(request);
}

export const config = {
    matcher: [
        '/',
        '/hub/:path*',
        '/discover/:path*',
        '/settings/:path*',
        '/messages/:path*',
        '/profile/:path*',
        '/my-profile/:path*',
        '/people/:path*',
        '/network/:path*',
        '/workspace/:path*',
        '/monitor/:path*',
        '/u/:path*',
        '/onboarding/:path*',
        '/login',
        '/signup',
    ],
};
