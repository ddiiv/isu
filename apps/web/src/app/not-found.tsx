import Link from "next/link";

export default function NoEncontrada() {
  return (
    <div className="contenedor py-24 text-center">
      <p className="font-display text-8xl text-marca">404</p>
      <h1 className="mt-4 text-4xl">No encontramos esta página</h1>
      <p className="mt-3 text-tinta-suave">Puede que la prenda ya no esté o que el enlace haya cambiado.</p>
      <Link href="/" className="boton-primario mt-8">Ir al inicio</Link>
    </div>
  );
}
