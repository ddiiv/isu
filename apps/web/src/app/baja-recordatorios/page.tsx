import type { Metadata } from "next";
import { BajaRecordatorios } from "@/components/BajaRecordatorios";

/*
 * «No quiero más recordatorios» del mail de carrito abandonado. El link sólo abre esta página:
 * la baja la hace el botón (un POST), así un robot de mail que abre los links no da de baja a nadie.
 * El token viaja en el fragmento (#t=…), que no llega al servidor ni a los logs ni a Analytics: lo lee el componente.
 */
export const metadata: Metadata = { title: "Darme de baja de los recordatorios", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function Baja() {
  return (
    <div className="contenedor max-w-xl pt-10 pb-20">
      <BajaRecordatorios />
    </div>
  );
}
