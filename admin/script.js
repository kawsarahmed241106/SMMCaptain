(() => {
  'use strict';
  const bootstrapClient = window.smmSupabaseBootstrap;
  let supabase = bootstrapClient;
  const table = 'site_settings';
  const defaults = {
    brandName: 'SMMCaptain.xyz',
    topNote: 'আপনার বিজ্ঞাপন, আপনার নিয়ন্ত্রণে',
    logoImage: '',
    heroTitle: 'আপনার ব্যবসার জন্য বিজ্ঞাপন দিন, সহজ বাংলায়',
    heroDescription: 'পোস্ট বা ভিডিওর লিংক দিন, লক্ষ্য ও অডিয়েন্স বেছে নিন, বাজেট দেখুন—তারপর অর্ডারের তথ্য জমা দিন।',
    orderGuideVideo: '',
    dollarRate: 150,
    exchangeRateNote: 'পেমেন্টের আগে যাচাই করুন',
    profileUrl: 'https://www.facebook.com/',
    profileLabel: 'Facebook Profile — Demo Link',
    instructionVideo: '',
    author_phone: '+8801843161825',
    author_country_code: '+880',
    supportWhatsapp: '8801300400618',
    supportMessengerLink: 'https://m.me/Smmcaptainsite',
    supportTelegramLink: 'https://t.me/Smmcaptainsite',
    noticeText: '',
    supabasePublishableKey: window.smmSupabaseBootstrapKey
  };
  const $ = (id) => document.getElementById(id);
  const form = $('settingsForm');
  const noticeInput = $('noticeText');
  const noticeWordCount = $('noticeWordCount');
  let loadedSettings = { ...defaults };
  let keyWarning = '';

  function countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/u).length : 0;
  }
  function updateNoticeWordCount() {
    const count = countWords(noticeInput.value);
    noticeWordCount.textContent = `${count} / 500 words`;
    noticeInput.setCustomValidity(count > 500 ? 'Notice text can contain at most 500 words.' : '');
  }
  noticeInput.addEventListener('input', updateNoticeWordCount);

  function showStatus(message, error = false) {
    $('saveStatus').textContent = message;
    $('saveStatus').style.color = error ? '#c83d37' : '';
  }
  async function loadSettings() {
    const { data, error } = await bootstrapClient.from(table).select('settings').eq('id', 1).maybeSingle();
    if (error) throw error;
    const settings = { ...defaults, ...(data?.settings || {}) };
    const key = settings.supabasePublishableKey || window.smmSupabaseBootstrapKey;
    supabase = window.createSmmSupabaseClient(key);
    keyWarning = '';
    if (key !== window.smmSupabaseBootstrapKey) {
      const { error: activeError } = await supabase.from(table).select('id').eq('id', 1).maybeSingle();
      if (activeError) {
        supabase = bootstrapClient;
        keyWarning = `Active key failed; using bootstrap key so you can correct it. ${activeError.message}`;
      }
    }
    return settings;
  }
  function showDashboard(settings = loadedSettings) {
    $('loginCard').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    $('adminNav').classList.remove('hidden');
    Object.entries(settings).forEach(([key, value]) => {
      const input = form.elements.namedItem(key);
      if (input) input.value = value;
    });
    updateNoticeWordCount();
    const phoneInput = $('author_phone');
    const countrySelect = $('authorCountryCode');
    const savedPhone = String(settings.author_phone || '').replace(/\D/g, '');
    const matchingCode = [...countrySelect.options]
      .map(option => option.value)
      .sort((a, b) => b.length - a.length)
      .find(code => savedPhone.startsWith(code.replace(/\D/g, '')));
    const countryCode = countrySelect.querySelector(`option[value="${matchingCode || settings.author_country_code || '+880'}"]`)
      ? (matchingCode || settings.author_country_code || '+880')
      : (settings.author_country_code || '+880');
    countrySelect.value = countryCode;
    let nationalNumber = savedPhone.startsWith(countryCode.replace(/\D/g, ''))
      ? savedPhone.slice(countryCode.replace(/\D/g, '').length)
      : savedPhone;
    if (countryCode === '+880' && nationalNumber && !nationalNumber.startsWith('0')) nationalNumber = `0${nationalNumber}`;
    phoneInput.value = nationalNumber;
  }
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('loginError').textContent = '';
    const button = $('loginForm').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await bootstrapClient.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value
      });
      if (error) throw error;
      loadedSettings = await loadSettings();
      const nextPage = new URLSearchParams(window.location.search).get('next');
      if (nextPage === 'orders.html') {
        window.location.replace('orders.html');
        return;
      }
      showDashboard();
      if (keyWarning) showStatus(keyWarning, true);
    } catch (error) {
      $('loginError').textContent = error.message.includes('site_settings')
        ? 'Admin login worked, but the database table or RLS setup is missing. Follow supabase/setup.sql.'
        : error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('logoutButton').addEventListener('click', async () => {
    await supabase.auth.signOut();
    $('adminNav').classList.add('hidden');
    $('dashboard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    $('password').value = '';
    $('password').focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    updateNoticeWordCount();
    if (!noticeInput.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const selectedCountryCode = $('authorCountryCode').value;
    const countryDigits = selectedCountryCode.replace(/\D/g, '');
    let authorDigits = data.author_phone.replace(/\D/g, '');
    if (!authorDigits.startsWith(countryDigits)) {
      if (selectedCountryCode === '+880' && authorDigits.startsWith('0')) authorDigits = authorDigits.slice(1);
      authorDigits = countryDigits + authorDigits;
    }
    if (authorDigits.length < 8 || authorDigits.length > 15) {
      $('author_phone').setCustomValidity('Enter a valid WhatsApp number with 8 to 15 digits.');
      $('author_phone').reportValidity();
      $('author_phone').setCustomValidity('');
      return;
    }
    data.author_phone = `+${authorDigits}`;
    data.author_country_code = selectedCountryCode;
    data.supportWhatsapp = (data.supportWhatsapp || '').replace(/\D/g, '');
    if (data.supportWhatsapp && (data.supportWhatsapp.length < 8 || data.supportWhatsapp.length > 15)) {
      form.elements.namedItem('supportWhatsapp').setCustomValidity('Enter an international WhatsApp number with 8 to 15 digits.');
      form.elements.namedItem('supportWhatsapp').reportValidity();
      form.elements.namedItem('supportWhatsapp').setCustomValidity('');
      return;
    }
    for (const [key, hosts] of [
      ['supportMessengerLink', ['m.me', 'facebook.com', 'messenger.com']],
      ['supportTelegramLink', ['t.me', 'telegram.me']]
    ]) {
      const value = data[key];
      if (!value) continue;
      let valid = false;
      try {
        const url = new URL(value);
        valid = url.protocol === 'https:' && hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
      } catch {}
      if (!valid) {
        form.elements.namedItem(key).setCustomValidity(key === 'supportMessengerLink'
          ? 'Enter a valid https://m.me or Facebook Messenger link.'
          : 'Enter a valid https://t.me or telegram.me link.');
        form.elements.namedItem(key).reportValidity();
        form.elements.namedItem(key).setCustomValidity('');
        return;
      }
    }
    for (const key of ['profileUrl', 'logoImage', 'instructionVideo', 'orderGuideVideo']) {
      if (data[key] && !/^https?:\/\//i.test(data[key])) {
        form.elements.namedItem(key).setCustomValidity('Enter a valid URL starting with http:// or https://');
        form.elements.namedItem(key).reportValidity();
        form.elements.namedItem(key).setCustomValidity('');
        return;
      }
    }
    if (data.orderGuideVideo && !/^https:\/\//i.test(data.orderGuideVideo)) {
      form.elements.namedItem('orderGuideVideo').setCustomValidity('Use a secure video link starting with https://');
      form.elements.namedItem('orderGuideVideo').reportValidity();
      form.elements.namedItem('orderGuideVideo').setCustomValidity('');
      return;
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(data.supabasePublishableKey || '')) {
      form.elements.namedItem('supabasePublishableKey').setCustomValidity('Use a Supabase publishable key (sb_publishable_…). Secret and service-role keys are not accepted.');
      form.elements.namedItem('supabasePublishableKey').reportValidity();
      form.elements.namedItem('supabasePublishableKey').setCustomValidity('');
      return;
    }
    const saveButton = form.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    showStatus('Saving…');
    try {
      const { error } = await supabase.from(table).upsert({ id: 1, settings: data }, { onConflict: 'id' });
      if (error) throw error;
      loadedSettings = { ...defaults, ...data };
      showStatus('Saved to Supabase. Reload the main page to see changes.');
    } catch (error) {
      const isPolicyError = error.code === '42501' || /row-level security policy/i.test(error.message || '');
      showStatus(isPolicyError
        ? 'Save failed: Admin access is not active. Run supabase/setup.sql, then log out and sign in again.'
        : `Save failed: ${error.message}`, true);
    } finally {
      saveButton.disabled = false;
    }
  });
  $('resetButton').addEventListener('click', () => {
    Object.entries(defaults).forEach(([key, value]) => { form.elements.namedItem(key).value = value; });
    updateNoticeWordCount();
    showStatus('Defaults loaded. Click Save changes to publish them.');
  });

  const loginButton = $('loginForm').querySelector('button[type="submit"]');
  loginButton.disabled = true;
  (async () => {
    try {
      // Do not restore persisted admin credentials after a page reload.
      const { error } = await bootstrapClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch (error) {
      $('loginError').textContent = `Could not clear the previous admin session: ${error.message}`;
    } finally {
      loginButton.disabled = false;
    }
  })();
})();
