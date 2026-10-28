(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('trackForm');
  const input = $('orderId');
  const result = $('trackResult');
  const button = $('trackButton');

  const statuses = {
    new: 'Pending · অর্ডার জমা হয়েছে',
    pending: 'Pending · অর্ডার জমা হয়েছে',
    processing: 'প্রক্রিয়াধীন · কাজ চলছে',
    completed: 'সম্পন্ন · সম্পন্ন হয়েছে',
    cancelled: 'Cancelled · বাতিল হয়েছে'
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

  const addOrderTime = (card, label, value, formatter) => {
    if (!value) return;
    const row = document.createElement('p');
    row.className = 'track-order-date';
    row.textContent = `${label}: ${formatter.format(new Date(value))} (বাংলাদেশ সময়)`;
    card.append(row);
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
    const searchValue = value.trim();
    const orderNumber = searchValue.toUpperCase();
    const isOrderId = /^SC-/i.test(searchValue);
    const phoneDigits = searchValue.replace(/\D/g, '');
    if (isOrderId && !/^SC-\d{8}-(?:\d{5}|[1-9]\d{3,})$/.test(orderNumber)) {
      showMessage('সঠিক অর্ডার আইডি লিখুন। উদাহরণ: SC-20261024-1041', true);
      input.focus();
      return;
    }
    if (!isOrderId && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
      showMessage('সঠিক অর্ডার আইডি অথবা ৮–১৫ সংখ্যার যোগাযোগ নম্বর লিখুন।', true);
      input.focus();
      return;
    }

    button.disabled = true;
    button.textContent = 'খোঁজা হচ্ছে…';
    showMessage('অর্ডারের তথ্য খোঁজা হচ্ছে…');
    try {
      const client = await getClient();
      const { data, error } = await client.rpc('track_campaign_orders', { p_search: searchValue });
      if (error) throw error;
      const orders = Array.isArray(data) ? data : data ? [data] : [];
      if (!orders.length) {
        showMessage(isOrderId ? 'এই আইডিতে কোনো পেইড অর্ডার পাওয়া যায়নি। আইডিটি আবার যাচাই করুন।' : 'এই নম্বরে কোনো পেইড অর্ডার পাওয়া যায়নি। নম্বরটি যাচাই করুন।', true);
        return;
      }

      result.replaceChildren();
      result.classList.remove('error');
      result.hidden = false;
      const heading = document.createElement('p');
      heading.className = 'track-result-title';
      heading.textContent = orders.length === 1 ? 'অর্ডার পাওয়া গেছে' : `আপনার অর্ডারসমূহ (${orders.length})`;
      result.append(heading);
      const formatter = new Intl.DateTimeFormat('bn-BD', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka'
      });
      orders.forEach(order => {
        const card = document.createElement('article');
        card.className = 'track-order-item';
        const top = document.createElement('div');
        top.className = 'track-order-top';
        const id = document.createElement('strong');
        id.className = 'track-order-number';
        id.textContent = order.order_number;
        const status = document.createElement('span');
        status.className = `track-order-status status-${order.status || 'pending'}`;
        status.textContent = statuses[order.status] || statuses.pending;
        top.append(id, status);
        card.append(top);
        addOrderTime(card, 'জমা দেওয়ার সময়', order.created_at, formatter);
        addOrderTime(card, 'কাজ শুরু হয়েছে', order.processing_started_at, formatter);
        addOrderTime(card, 'সম্ভাব্য সম্পন্নের সময়', order.completion_at, formatter);
        addOrderTime(card, 'সম্পন্ন হয়েছে', order.completed_at, formatter);
        if (order.status === 'cancelled' && order.cancellation_reason) {
          const cancellation = document.createElement('p');
          cancellation.className = 'track-cancellation-reason';
          cancellation.textContent = `বাতিলের কারণ: ${order.cancellation_reason}`;
          card.append(cancellation);
        }
        result.append(card);
      });
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

  const params = new URLSearchParams(window.location.search);
  const initialSearch = params.get('order_id') || params.get('phone');
  if (initialSearch) {
    input.value = initialSearch;
    lookupOrder(initialSearch);
  }
})();
