import Link from "next/link";
import Logo from "@/components/layout/header/Logo";
import { BackButton } from "@/components/layout/header/BackButton";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main className="nb-grid-ground relative min-h-dvh flex flex-col items-center justify-center gap-6 p-6 text-center">
    {/* A way back on every page, even in the installed app (unified back A1). */}
    <div className="absolute left-4 top-4"><BackButton fallback="/discover" /></div>
    <Logo /><p className="nb-micro">404 / Page unavailable</p><h1 className="nb-page-title">Page not found</h1>
    <p className="max-w-[40ch] text-muted-foreground">We couldn’t find this page. Check the address or return to Discover.</p>
    <Button asChild><Link href="/discover">Go to Discover</Link></Button>
  </main>;
}
