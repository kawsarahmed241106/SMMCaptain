(() => {
  'use strict';
  const client = window.smmSupabaseBootstrap;
  const $ = id => document.getElementById(id);
  const status = $('ordersStatus');
  const list = $('ordersList');
  let reloadSessionCleared = false;

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

  const orderStatuses = [
    { value: 'pending', label: 'Pending' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];
  const normaliseStatus = value => value === 'new' ? 'pending' : value;

  function updateStatusBadge(badge, value) {
    const statusValue = normaliseStatus(value);
    const selected = orderStatuses.find(item => item.value === statusValue);
    badge.textContent = selected?.label || 'Pending';
    badge.className = `order-status status-${statusValue}`;
    badge.setAttribute('aria-label', `Order status: ${selected?.label || 'Pending'}`);
  }

  function renderOrder(order) {
    const card = document.createElement('article');
    card.className = 'order-card';
    const head = document.createElement('div');
    head.className = 'order-head';
    const heading = document.createElement('div');
    addText(heading, 'h2', order.order_number);
    addText(heading, 'p', formatDate(order.created_at), 'order-date');
    head.append(heading);
    const initialStatus = normaliseStatus(order.status);
    const badge = addText(head, 'span', '', 'order-status');
    updateStatusBadge(badge, initialStatus);
    card.append(head);

    const statusControl = document.createElement('div');
    statusControl.className = 'order-status-control';
    const statusLabel = document.createElement('label');
    statusLabel.textContent = 'Order status';
    const statusSelect = document.createElement('select');
    statusSelect.setAttribute('aria-label', `Change status for ${order.order_number}`);
    orderStatuses.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      statusSelect.append(option);
    });
    statusSelect.value = orderStatuses.some(item => item.value === initialStatus) ? initialStatus : 'pending';
    const saveMessage = document.createElement('span');
    saveMessage.className = 'status-save-message';
    saveMessage.setAttribute('role', 'status');
    statusSelect.addEventListener('change', async () => {
      const nextStatus = statusSelect.value;
      statusSelect.disabled = true;
      saveMessage.textContent = 'Saving…';
      saveMessage.classList.remove('is-error');
      try {
        const { error } = await client.from('orders').update({ status: nextStatus }).eq('id', order.id);
        if (error) throw error;
        order.status = nextStatus;
        updateStatusBadge(badge, nextStatus);
        saveMessage.textContent = 'Status saved';
      } catch (error) {
        console.error(`Could not update ${order.order_number}.`, error);
        statusSelect.value = normaliseStatus(order.status);
        saveMessage.textContent = error.message || 'Could not save status. Check admin SQL permissions.';
        saveMessage.classList.add('is-error');
      } finally {
        statusSelect.disabled = false;
      }
    });
    card.append(statusControl);
    statusControl.append(statusLabel, statusSelect, saveMessage);

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
      const navigation = performance.getEntriesByType('navigation')[0];
      if (!reloadSessionCleared && navigation?.type === 'reload') {
        reloadSessionCleared = true;
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        setStatus('You were signed out after reloading. Sign in again to view orders.', true);
        addText(list, 'a', 'Go to admin sign in →', 'orders-login-link').href = 'index.html';
        return;
      }
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
