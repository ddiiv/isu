import Image from "next/image";
import Link from "next/link";
import isotipo from "@isu/ui/marca/isotipo-96.png";

/* Isotipo del corredor + nombre en la tipografía de títulos. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} aria-label="Isuwaya, ir al inicio">
      <Image src={isotipo} alt="" width={36} height={36} priority className="size-8 sm:size-9" />
      <span className="font-display text-[1.45rem] leading-none tracking-tight text-marca sm:text-[1.6rem]">Isuwaya</span>
    </Link>
  );
}
