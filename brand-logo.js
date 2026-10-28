(() => {
  'use strict';

  const applyLogo = (url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return;
    const logoUrl = url.trim();
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.href = logoUrl;
      favicon.removeAttribute('type');
    }

    document.querySelectorAll('[data-brand-logo]').forEach(container => {
      const image = document.createElement('img');
      image.className = 'brand-logo-image';
      image.src = logoUrl;
      image.alt = '';
      image.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.textContent = 'S';
        if (container.classList.contains('logo')) fallback.className = 'logo-fallback';
        container.replaceChildren(fallback);
        if (favicon) {
          favicon.href = '/favicon.svg';
          favicon.type = 'image/svg+xml';
        }
      }, { once: true });
      container.replaceChildren(image);
    });
  };

  async function loadBrandLogo() {
    const client = window.smmSupabaseBootstrap;
    if (!client || !document.querySelector('[data-brand-logo]')) return;

    try {
      const { data, error } = await client
        .from('site_settings')
        .select('settings')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      applyLogo(data?.settings?.logoImage);
    } catch (error) {
      console.warn('The shared site logo could not be loaded.', error);
    }
  }

  loadBrandLogo();
})();
