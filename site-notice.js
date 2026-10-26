(() => {
  'use strict';

  const bar = document.querySelector('[data-site-notice]');
  const marquee = bar?.querySelector('[data-site-notice-text]');
  if (!bar || !marquee) return;

  async function loadNotice() {
    const client = window.smmSupabaseBootstrap;
    if (!client) return;
    const { data, error } = await client
      .from('site_settings')
      .select('settings')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;

    const message = typeof data?.settings?.noticeText === 'string'
      ? data.settings.noticeText.trim()
      : '';
    if (!message) return;

    marquee.textContent = message;
    marquee.setAttribute('direction', 'left');
    marquee.setAttribute('loop', '-1');
    bar.hidden = false;
  }

  loadNotice().catch(error => console.warn('Website notice could not be loaded.', error));
})();
