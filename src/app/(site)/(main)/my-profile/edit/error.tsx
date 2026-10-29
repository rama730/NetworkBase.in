'use client';

import { Button } from '@/components/ui/button';

export default function EditProfileError({ reset }: { reset: () => void }) {
    return <section role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="nb-section-title">Unable to load the profile editor</h1>
        <p className="nb-body text-muted-foreground">Your profile could not be loaded. Try again.</p>
        <Button onClick={reset}>Try again</Button>
    </section>;
}
