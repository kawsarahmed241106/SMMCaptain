(() => {
  'use strict';

  const bar = document.querySelector('[data-site-notice]');
  const track = bar?.querySelector('[data-site-notice-text]');
  if (!bar || !track) return;

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

    const primaryCopy = document.createElement('span');
    primaryCopy.className = 'site-notice-copy';
    primaryCopy.textContent = message;
    const repeatedCopy = document.createElement('span');
    repeatedCopy.className = 'site-notice-copy';
    repeatedCopy.textContent = message;
    repeatedCopy.setAttribute('aria-hidden', 'true');
    track.replaceChildren(primaryCopy, repeatedCopy);
    track.style.setProperty('--notice-duration', `${Math.max(18, Math.min(48, message.length * 0.4))}s`);
    bar.hidden = false;
  }

  loadNotice().catch(error => console.warn('Website notice could not be loaded.', error));
})();
