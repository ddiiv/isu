import Script from "next/script";

export const idGa = () => {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  return id && /^G-[A-Z0-9]{4,}$/.test(id) ? id : null;
};

/*
 * Consent Mode v2: va como <script> común en el <head> del layout raíz (no
 * next/script), así corre antes que cualquier otra cosa: el `default` en
 * "denied" y, si ya hay una elección guardada, el `update` en el acto. Recién
 * después cargan gtag.js y el `config`, que ya nacen con la elección. Debe
 * mantenerse igual a `valoresConsentimiento` de @isu/shared.
 */
export function ConsentimientoGa() {
  if (!idGa()) return null;
  const js = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}var d='denied';gtag('consent','default',{ad_storage:d,ad_user_data:d,ad_personalization:d,analytics_storage:d,wait_for_update:500});try{var e=localStorage.getItem('isu:consent');if(e==='granted'||e==='denied')gtag('consent','update',{ad_storage:e,ad_user_data:e,ad_personalization:e,analytics_storage:e});}catch(_){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

/*
 * Google Analytics 4. Sin ID configurado no se carga nada.
 *
 * Carga después de que la página es interactiva: nunca frena el primer
 * render. Los eventos de e-commerce (view_item, add_to_cart, purchase) se
 * mandan desde las pantallas de catálogo y checkout (etapas 1 y 2). El clic
 * en cualquier link de WhatsApp (wa.me) sale acá como `contact`, con el
 * `data-origen` del link o, si no tiene, la página.
 */
export function Analytics() {
  const id = idGa();
  if (!id) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});document.addEventListener('click',function(e){try{var a=e.target.closest&&e.target.closest('a[href^="https://wa.me/"]');if(a)gtag('event','contact',{method:'whatsapp',origen:a.dataset.origen||location.pathname});}catch(_){}},true);`}
      </Script>
    </>
  );
}
