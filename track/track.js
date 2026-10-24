(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('trackForm');
  const input = $('orderId');
  const result = $('trackResult');
  const button = $('trackButton');

  const statuses = {
    new: 'অর্ডার জমা হয়েছে',
    processing: 'কাজ চলছে',
    completed: 'সম্পন্ন হয়েছে',
    cancelled: 'বাতিল হয়েছে'
  };

  const showMessage = (message, isError = false) => {
    result.replaceChildren();
    result.classList.toggle('error', isError);
    result.hidden = false;
    const text = document.createElement('p');
    text.className = 'track-result-title';
    text.textContent = message;
    result.append(text);
  };

  const addRow = (label, value) => {
    const row = document.createElement('div');
    row.className = 'track-result-row';
    const key = document.createElement('span');
    key.className = 'track-result-label';
    key.textContent = label;
    const data = document.createElement('span');
    data.className = 'track-result-value';
    data.textContent = value;
    row.append(key, data);
    result.append(row);
  };

  async function getClient() {
    const bootstrap = window.smmSupabaseBootstrap;
    if (!bootstrap) throw new Error('Supabase সংযোগ পাওয়া যায়নি।');

    try {
      const { data, error } = await bootstrap.from('site_settings').select('settings').eq('id', 1).maybeSingle();
      const activeKey = data?.settings?.supabasePublishableKey;
      if (!error && activeKey && window.createSmmSupabaseClient) {
        return window.createSmmSupabaseClient(activeKey);
      }
    } catch (error) {
      console.warn('Could not load the active Supabase key; using the bootstrap client.', error);
    }
    return bootstrap;
  }

  async function lookupOrder(value) {
    const orderNumber = value.trim().toUpperCase();
    if (!/^SC-\d{8}-(?:\d{5}|[1-9]\d{3,})$/.test(orderNumber)) {
      showMessage('সঠিক অর্ডার আইডি লিখুন। উদাহরণ: SC-20261024-1041', true);
      input.focus();
      return;
    }

    button.disabled = true;
    button.textContent = 'খোঁজা হচ্ছে…';
    showMessage('অর্ডারের তথ্য খোঁজা হচ্ছে…');
    try {
      const client = await getClient();
      const { data, error } = await client.rpc('track_campaign_order', { p_order_number: orderNumber });
      if (error) throw error;
      const order = Array.isArray(data) ? data[0] : data;
      if (!order?.order_number) {
        showMessage('এই আইডিতে কোনো অর্ডার পাওয়া যায়নি। আইডিটি আবার যাচাই করুন।', true);
        return;
      }

      result.replaceChildren();
      result.classList.remove('error');
      result.hidden = false;
      const heading = document.createElement('p');
      heading.className = 'track-result-title';
      heading.textContent = 'অর্ডার পাওয়া গেছে';
      result.append(heading);
      addRow('অর্ডার আইডি', order.order_number);
      addRow('অবস্থা', statuses[order.status] || order.status);
      addRow('জমা দেওয়ার সময়', new Intl.DateTimeFormat('bn-BD', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka'
      }).format(new Date(order.created_at)) + ' (বাংলাদেশ সময়)');
    } catch (error) {
      console.error('Could not track the order.', error);
      showMessage('অর্ডারের তথ্য আনা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।', true);
    } finally {
      button.disabled = false;
      button.textContent = 'অর্ডার খুঁজুন';
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    lookupOrder(input.value);
  });

  const initialOrder = new URLSearchParams(window.location.search).get('order_id');
  if (initialOrder) {
    input.value = initialOrder;
    lookupOrder(initialOrder);
  }
})();
