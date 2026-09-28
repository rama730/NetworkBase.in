import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

export default function Logo({ href = "/", size }: { href?: string; size?: number }) {
    return (
        <Link href={href} className="nb-wordmark" aria-label="NetworkBase home">
            <BrandMark size={size} />
        </Link>
    );
}
