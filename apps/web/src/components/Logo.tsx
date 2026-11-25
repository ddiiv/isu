import Image from "next/image";
import Link from "next/link";
import isotipo from "@isu/ui/marca/isotipo-96.png";
import { GorroNavidad } from "./GorroNavidad";

/* Isotipo del corredor + nombre en la tipografía de títulos. */
export function Logo({ className = "", gorro = false }: { className?: string; gorro?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} aria-label="Isuwaya, ir al inicio">
      <span className="relative inline-flex">
        <Image src={isotipo} alt="" width={36} height={36} priority className="size-8 sm:size-9" />
        {/* Edición Navidad: el gorrito va sobre el punto (la cabeza) del isotipo. */}
        {gorro && <GorroNavidad className="left-[38%] -top-[34%] aspect-[40/36] w-[62%]" />}
      </span>
      <span className="font-display text-[1.45rem] leading-none tracking-tight text-marca sm:text-[1.6rem]">Isuwaya</span>
    </Link>
  );
}
