import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import ForgotPasswordPage from '@/app/(site)/(auth)/forgot-password/page';

// Sign-in and sign-up with the Cloudflare check (docs/superpowers/plans/2026-11-09-social-login-cloudflare-findings.md).
// A stand-in for Cloudflare's script: every render passes at once with a new token, unless ?hold keeps it waiting.
const params = new URLSearchParams(location.search);
type Win = Window & { renders?: number; passCheck?: () => void; oauth?: { provider: string; redirectTo: string } };
const win = window as Win;
(window as unknown as { turnstile: unknown }).turnstile = {
    render(container: HTMLElement, options: { callback?: (token: string) => void }) {
        const n = (win.renders = (win.renders || 0) + 1);
        container.textContent = 'Cloudflare check';
        win.passCheck = () => options.callback?.(`token-${n}`);
        if (!params.get('hold')) setTimeout(() => win.passCheck?.(), 0);
        return `widget-${n}`;
    },
    remove() {},
};

const page = params.get('page');
createRoot(document.getElementById('root')!).render(
    page === 'signup' ? <SignupForm redirect={null} invite={null} project={null} />
        : page === 'forgot' ? <ForgotPasswordPage />
        : <LoginForm redirect={null} error={params.get('error')} step={null} />,
);
