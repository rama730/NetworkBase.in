import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

export default function Logo({ href = "/", size, trademark = false }: { href?: string; size?: number; trademark?: boolean }) {
    return (
        <Link href={href} className="nb-wordmark max-md:min-h-11 max-md:items-center" aria-label="NetworkBase home">
            <BrandMark size={size} trademark={trademark} />
        </Link>
    );
}
