import Script from "next/script";

/*
 * Google Analytics 4. Sin ID configurado no se carga nada.
 *
 * Carga después de que la página es interactiva: nunca frena el primer
 * render. Los eventos de e-commerce (view_item, add_to_cart, purchase) se
 * mandan desde las pantallas de catálogo y checkout (etapas 1 y 2).
 */
export function Analytics() {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  if (!id || !/^G-[A-Z0-9]{4,}$/.test(id)) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});`}
      </Script>
    </>
  );
}
