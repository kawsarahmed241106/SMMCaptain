(() => {
  'use strict';
  const supabase = window.smmSupabaseClient;
  const table = 'site_settings';
  const defaults = {
    brandName: 'SMMCaptain.xyz',
    topNote: 'আপনার বিজ্ঞাপন, আপনার নিয়ন্ত্রণে',
    logoImage: '',
    heroEyebrow: 'সহজ অনলাইন বিজ্ঞাপন',
    heroTitle: 'আপনার ব্যবসার জন্য বিজ্ঞাপন দিন, সহজ বাংলায়',
    heroDescription: 'পোস্ট বা ভিডিওর লিংক দিন, লক্ষ্য ও অডিয়েন্স বেছে নিন, বাজেট দেখুন—তারপর অর্ডারের তথ্য জমা দিন।',
    exchangeRate: '৳১৫০ / $১',
    profileUrl: 'https://www.facebook.com/',
    profileLabel: 'Facebook Profile — Demo Link',
    instructionVideo: ''
  };
  const $ = (id) => document.getElementById(id);
  const form = $('settingsForm');
  let loadedSettings = { ...defaults };

  function showStatus(message, error = false) {
    $('saveStatus').textContent = message;
    $('saveStatus').style.color = error ? '#c83d37' : '';
  }
  async function loadSettings() {
    const { data, error } = await supabase.from(table).select('settings').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { ...defaults, ...(data?.settings || {}) };
  }
  function showDashboard(settings = loadedSettings) {
    $('loginCard').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    Object.entries(settings).forEach(([key, value]) => {
      const input = form.elements.namedItem(key);
      if (input) input.value = value;
    });
  }
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('loginError').textContent = '';
    const button = $('loginForm').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value
      });
      if (error) throw error;
      loadedSettings = await loadSettings();
      showDashboard();
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
    $('dashboard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    $('password').value = '';
    $('password').focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of ['profileUrl', 'logoImage', 'instructionVideo']) {
      if (data[key] && !/^https?:\/\//i.test(data[key])) {
        form.elements.namedItem(key).setCustomValidity('Enter a valid URL starting with http:// or https://');
        form.elements.namedItem(key).reportValidity();
        form.elements.namedItem(key).setCustomValidity('');
        return;
      }
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
      showStatus(`Save failed: ${error.message}`, true);
    } finally {
      saveButton.disabled = false;
    }
  });
  $('resetButton').addEventListener('click', () => {
    Object.entries(defaults).forEach(([key, value]) => { form.elements.namedItem(key).value = value; });
    showStatus('Defaults loaded. Click Save changes to publish them.');
  });

  (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      try {
        loadedSettings = await loadSettings();
        showDashboard();
      } catch (error) {
        $('loginError').textContent = `Could not load settings: ${error.message}`;
        await supabase.auth.signOut();
      }
    }
  })();
})();
