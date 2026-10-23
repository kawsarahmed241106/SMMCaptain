(() => {
  'use strict';
  const client = window.smmSupabaseBootstrap;
  const $ = id => document.getElementById(id);
  const status = $('ordersStatus');
  const list = $('ordersList');

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('notice-error', isError);
  };
  const addText = (parent, tag, text, className) => {
    const element = document.createElement(tag);
    element.textContent = text ?? '';
    if (className) element.className = className;
    parent.append(element);
    return element;
  };
  const formatDate = value => new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka'
  }).format(new Date(value)) + ' (Bangladesh time)';

  function renderOrder(order) {
    const card = document.createElement('article');
    card.className = 'order-card';
    const head = document.createElement('div');
    head.className = 'order-head';
    const heading = document.createElement('div');
    addText(heading, 'h2', order.order_number);
    addText(heading, 'p', formatDate(order.created_at), 'order-date');
    head.append(heading);
    const badge = addText(head, 'span', order.status, `order-status status-${order.status}`);
    badge.setAttribute('aria-label', `Order status: ${order.status}`);
    card.append(head);

    const contact = document.createElement('div');
    contact.className = 'order-contact';
    addText(contact, 'p', `Contact WhatsApp: ${order.customer_phone}`);
    if (order.ad_whatsapp) addText(contact, 'p', `Message recipient WhatsApp: ${order.ad_whatsapp}`);
    card.append(contact);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View campaign details';
    details.append(summary);
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(order.details ?? {}, null, 2);
    details.append(pre);
    card.append(details);
    return card;
  }

  async function loadOrders() {
    $('refreshOrders').disabled = true;
    list.replaceChildren();
    $('ordersFooter').textContent = '';
    setStatus('Checking admin access…');
    try {
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        setStatus('Sign in on the admin page first, then open this page again.', true);
        addText(list, 'a', 'Go to admin sign in →', 'orders-login-link').href = 'index.html';
        return;
      }
      const { data, error } = await client.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      if (!data.length) {
        setStatus('No orders have been submitted yet.');
        return;
      }
      setStatus(`Showing ${data.length} most recent order${data.length === 1 ? '' : 's'}.`);
      data.forEach(order => list.append(renderOrder(order)));
      $('ordersFooter').textContent = 'Showing up to 100 recent orders.';
    } catch (error) {
      console.error('Could not load campaign orders.', error);
      setStatus(`Could not load orders: ${error.message || 'Check the SQL setup and admin access.'}`, true);
    } finally {
      $('refreshOrders').disabled = false;
    }
  }

  $('refreshOrders').addEventListener('click', loadOrders);
  loadOrders();
})();
