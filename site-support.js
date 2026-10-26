(() => {
  'use strict';

  const iconMarkup = {
    headset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13v-2a9 9 0 0 1 18 0v2"/><path d="M5 13h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3v-3a1 1 0 0 1 1-1Zm14 0h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-3a1 1 0 0 0-1-1ZM15 20h-3"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8.4 8.4 0 0 1-12.5 7.3L3 20l1.3-4.3A8.4 8.4 0 1 1 20 11.5Z"/><path d="M8.5 8.2c.3-.5.6-.5.9-.5h.4c.2 0 .4.1.5.4l.7 1.7c.1.2.1.4-.1.6l-.5.6c-.2.2-.2.4 0 .6.4.7 1.1 1.4 1.8 1.8.2.1.4.1.6-.1l.7-.8c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.4.5 0 .4-.2 1.1-.6 1.5-.5.5-1.2.7-2 .5-1.3-.3-2.8-1.1-4.2-2.5-1.1-1.1-1.8-2.4-2-3.4-.2-.7.1-1.3.4-1.6Z"/></svg>',
    messenger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.9 3 3 6.7 3 11.3c0 2.6 1.3 4.8 3.4 6.3V21l3.1-1.7c.8.2 1.6.3 2.5.3 5.1 0 9-3.7 9-8.3S17.1 3 12 3Z"/><path d="m7.5 13.7 3.2-3.4 2.5 1.9 3.3-1.9-3.2 3.4-2.5-1.9-3.3 1.9Z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 4-3.2 16-6.1-4.3-3.3 3.1.5-5.2L19 6.1 7.3 12.8 3 11.2 21 4Z"/><path d="m9.1 13.6 8.6-7.5"/></svg>'
  };

  const makeIcon = (name, className) => {
    const node = document.createElement('span');
    node.className = className;
    node.innerHTML = iconMarkup[name];
    return node;
  };

  const overlay = document.createElement('button');
  overlay.className = 'site-support-overlay';
  overlay.type = 'button';
  overlay.setAttribute('aria-label', 'Close support panel');
  overlay.hidden = true;

  const panel = document.createElement('section');
  panel.className = 'site-support-panel';
  panel.id = 'siteSupportPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'siteSupportTitle');
  panel.hidden = true;

  const header = document.createElement('header');
  header.className = 'site-support-header';
  const headingGroup = document.createElement('div');
  const heading = document.createElement('h2');
  heading.className = 'site-support-title';
  heading.id = 'siteSupportTitle';
  heading.textContent = 'Need Support?';
  const online = document.createElement('p');
  online.className = 'site-support-online';
  online.textContent = '● We’re Online 24/7';
  headingGroup.append(heading, online);

  const closeButton = document.createElement('button');
  closeButton.className = 'site-support-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close support panel');
  closeButton.innerHTML = iconMarkup.close;
  header.append(headingGroup, closeButton);

  const links = document.createElement('nav');
  links.className = 'site-support-links';
  links.setAttribute('aria-label', 'Support channels');
  const channels = [
    { key: 'whatsapp', title: 'WhatsApp Support', detail: 'Chat instantly', href: 'https://wa.me/8801300400618', icon: 'whatsapp' },
    { key: 'messenger', title: 'Messenger Support', detail: 'Chat instantly', href: 'https://m.me/Smmcaptainsite', icon: 'messenger' },
    { key: 'telegram', title: 'Telegram Support', detail: 'Chat instantly', href: 'https://t.me/Smmcaptainsite', icon: 'telegram' }
  ];
  const channelLinks = {};

  for (const channel of channels) {
    const link = document.createElement('a');
    link.className = 'site-support-link';
    link.href = channel.href;
    channelLinks[channel.key] = link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(makeIcon(channel.icon, 'site-support-icon'));
    const copy = document.createElement('span');
    copy.className = 'site-support-link-copy';
    const title = document.createElement('strong');
    title.textContent = channel.title;
    const detail = document.createElement('small');
    detail.textContent = channel.detail;
    copy.append(title, detail);
    link.append(copy);
    links.append(link);
  }

  async function applySavedSupportLinks() {
    const client = window.smmSupabaseBootstrap;
    if (!client) return;
    const { data, error } = await client.from('site_settings').select('settings').eq('id', 1).maybeSingle();
    if (error) throw error;
    const settings = data?.settings || {};

    const whatsappDigits = String(settings.supportWhatsapp ?? '8801300400618').replace(/\D/g, '');
    if (whatsappDigits.length >= 8 && whatsappDigits.length <= 15) {
      channelLinks.whatsapp.href = `https://wa.me/${whatsappDigits}`;
      channelLinks.whatsapp.hidden = false;
    } else {
      channelLinks.whatsapp.hidden = true;
    }

    const applyHttpsLink = (link, value, allowedHosts, fallback) => {
      if (value === '') {
        link.hidden = true;
        return;
      }
      try {
        const url = new URL(value || fallback);
        const allowed = allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
        if (url.protocol === 'https:' && allowed) {
          link.href = url.href;
          link.hidden = false;
          return;
        }
      } catch {}
      link.hidden = true;
    };

    applyHttpsLink(channelLinks.messenger, settings.supportMessengerLink,
      ['m.me', 'facebook.com', 'messenger.com'], 'https://m.me/Smmcaptainsite');
    applyHttpsLink(channelLinks.telegram, settings.supportTelegramLink,
      ['t.me', 'telegram.me'], 'https://t.me/Smmcaptainsite');
  }

  const footer = document.createElement('div');
  footer.className = 'site-support-footer';
  footer.textContent = '© SMMCaptain · Premium Support';
  panel.append(header, links, footer);

  const toggle = document.createElement('button');
  toggle.className = 'site-support-button';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Open support options');
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(makeIcon('headset', 'site-support-button-icon'));
  document.body.append(overlay, panel, toggle);

  let isOpen = false;
  function setOpen(open) {
    isOpen = open;
    panel.hidden = !open;
    overlay.hidden = !open;
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close support options' : 'Open support options');
    toggle.querySelector('.site-support-button-icon').innerHTML = iconMarkup[open ? 'close' : 'headset'];
    if (open) closeButton.focus();
    else toggle.focus();
  }

  toggle.addEventListener('click', () => setOpen(!isOpen));
  closeButton.addEventListener('click', () => setOpen(false));
  overlay.addEventListener('click', () => setOpen(false));
  links.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('a[href], button:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  applySavedSupportLinks().catch(error => console.warn('Support links could not be loaded.', error));
})();
