(() => {
  'use strict';
  const client = window.smmSupabaseBootstrap;
  const $ = id => document.getElementById(id);
  const status = $('ordersStatus');
  const list = $('ordersList');
  const deleteDialog = $('deleteOrderDialog');
  const deleteForm = $('deleteOrderForm');
  const deletePassword = $('deleteOrderPassword');
  const deleteOrderLabel = $('deleteOrderLabel');
  const deleteError = $('deleteOrderError');
  let reloadSessionCleared = false;
  let adminEmail = '';
  let orderPendingDelete = null;
  let deleteButtonPending = null;

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

  function renderOrderTimer(container, order) {
    let section = container.querySelector('.order-timer');
    if (!section) {
      section = document.createElement('div');
      section.className = 'order-timer';
      container.append(section);
    }
    section.replaceChildren();
    const items = [
      ['Processing started', order.processing_started_at],
      ['Expected completion', order.completion_at],
      ['Completed', order.completed_at]
    ].filter(([, value]) => value);
    if (!items.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    items.forEach(([label, value]) => {
      const row = document.createElement('p');
      row.textContent = `${label}: ${formatDate(value)}`;
      section.append(row);
    });
  }

  const displayValue = value => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '';
    return String(value);
  };

  function addDetailSection(container, title, details, fields) {
    const rows = fields
      .map(([key, label, formatter]) => {
        const rawValue = details[key];
        if ((rawValue === null || rawValue === undefined || rawValue === '') && key !== 'ageMin') return null;
        const value = formatter ? formatter(rawValue, details) : displayValue(rawValue);
        return value ? { label, value } : null;
      })
      .filter(Boolean);
    if (!rows.length) return;

    const section = document.createElement('section');
    section.className = 'order-detail-section';
    addText(section, 'h3', title);
    const grid = document.createElement('dl');
    grid.className = 'order-detail-grid';
    rows.forEach(({ label, value }) => {
      addText(grid, 'dt', label);
      addText(grid, 'dd', value);
    });
    section.append(grid);
    container.append(section);
  }

  function renderCampaignDetails(details = {}) {
    const container = document.createElement('div');
    container.className = 'order-details-content';

    // Keep these groups in the same sequence as sections 1–4 on the main form.
    addDetailSection(container, '1. Post information', details, [
      ['platform', 'Platform'],
      ['postLink', 'Post / video link'],
      ['accessConfirmed', 'Page access confirmed']
    ]);
    addDetailSection(container, '2. Campaign goal', details, [
      ['goalLabel', 'Goal'],
      ['messageChannels', 'Message channels'],
      ['adWhatsapp', 'WhatsApp destination'],
      ['messageTemplate', 'Message template'],
      ['customMessage', 'Custom message'],
      ['leadType', 'Lead collection method'],
      ['leadOffer', 'Lead information requested'],
      ['salesUrl', 'Product / sales link'],
      ['destinationUrl', 'Destination link']
    ]);
    addDetailSection(container, '3. Audience', details, [
      ['country', 'Country'],
      ['district', 'District'],
      ['upazila', 'Upazila'],
      ['location', 'Area / city'],
      ['radiusKm', 'Target radius', value => `${value} km`],
      ['gender', 'Gender'],
      ['ageMin', 'Age range', (_value, data) => data.ageMin != null || data.ageMax != null ? `${data.ageMin ?? '—'}–${data.ageMax ?? '—'}` : ''],
      ['interests', 'Interests']
    ]);
    addDetailSection(container, '4. Schedule and budget', details, [
      ['days', 'Duration', value => `${value} days`],
      ['schedule', 'Schedule'],
      ['scheduleStart', 'Start time'],
      ['scheduleEnd', 'End time'],
      ['dailyBudgetUsd', 'Daily budget', value => `$${Number(value).toLocaleString('en-US')}`],
      ['dollarRate', 'Exchange rate', value => `৳${Number(value).toLocaleString('en-US')} / $1`],
      ['totalBudgetUsd', 'Total budget (USD)', value => `$${Number(value).toLocaleString('en-US')}`],
      ['totalBudgetBdt', 'Total budget (BDT)', value => `৳${Number(value).toLocaleString('en-US')}`]
    ]);
    addDetailSection(container, 'Confirmation', details, [
      ['termsAccepted', 'Terms accepted']
    ]);

    if (!container.childElementCount) addText(container, 'p', 'No campaign details were saved.', 'muted');
    return container;
  }

  function requestOrderDeletion(order, card, button) {
    orderPendingDelete = { order, card };
    deleteButtonPending = button;
    deleteOrderLabel.textContent = order.order_number;
    deletePassword.value = '';
    deleteError.textContent = '';
    deleteError.hidden = true;
    deleteDialog.showModal();
    deletePassword.focus();
  }

  deleteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!orderPendingDelete || !adminEmail) return;

    const password = deletePassword.value;
    const { order, card } = orderPendingDelete;
    const submitButton = deleteForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    deleteButtonPending.disabled = true;
    deleteError.hidden = true;
    try {
      const { error: authError } = await client.auth.signInWithPassword({ email: adminEmail, password });
      if (authError) throw new Error('Password was not accepted. Check your admin password and try again.');

      const { error } = await client.from('orders').delete().eq('id', order.id);
      if (error) throw error;

      card.remove();
      setStatus(`Order ${order.order_number} was deleted.`);
      $('ordersFooter').textContent = `${list.querySelectorAll('.order-card').length} order(s) shown.`;
      deleteDialog.close();
    } catch (error) {
      console.error(`Could not delete ${order.order_number}.`, error);
      deleteError.textContent = error.message || 'Could not delete this order. Check the SQL setup and admin access.';
      deleteError.hidden = false;
    } finally {
      deletePassword.value = '';
      submitButton.disabled = false;
      if (deleteButtonPending?.isConnected) deleteButtonPending.disabled = false;
    }
  });

  deleteDialog.addEventListener('close', () => {
    deletePassword.value = '';
    orderPendingDelete = null;
    deleteButtonPending = null;
  });
  $('cancelDeleteOrder').addEventListener('click', () => deleteDialog.close());

  function renderOrder(order) {
    const card = document.createElement('article');
    card.className = 'order-card';
    const head = document.createElement('div');
    head.className = 'order-head';
    const heading = document.createElement('div');
    addText(heading, 'h2', order.order_number);
    addText(heading, 'p', formatDate(order.created_at), 'order-date');
    const initialStatus = normaliseStatus(order.status);
    const badge = addText(head, 'span', '', 'order-status');
    updateStatusBadge(badge, initialStatus);
    const headActions = document.createElement('div');
    headActions.className = 'order-head-actions';
    headActions.append(badge);
    const deleteButton = addText(headActions, 'button', 'Delete order', 'delete-order-button');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', () => requestOrderDeletion(order, card, deleteButton));
    head.append(heading, headActions);
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
    renderOrderTimer(card, order);
    statusSelect.addEventListener('change', async () => {
      const nextStatus = statusSelect.value;
      statusSelect.disabled = true;
      saveMessage.textContent = 'Saving…';
      saveMessage.classList.remove('is-error');
      try {
        const { data, error } = await client.from('orders').update({ status: nextStatus })
          .eq('id', order.id)
          .select('status, processing_started_at, completion_at, completed_at')
          .single();
        if (error) throw error;
        order.status = nextStatus;
        Object.assign(order, data);
        updateStatusBadge(badge, nextStatus);
        renderOrderTimer(card, order);
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
    const testReminderButton = addText(statusControl, 'button', 'Send test expiry reminder', 'test-reminder-button');
    testReminderButton.type = 'button';
    testReminderButton.setAttribute('aria-label', `Send a test expiry reminder to ${order.order_number}`);
    testReminderButton.addEventListener('click', async () => {
      if (!window.confirm(`Send a real test WhatsApp expiry reminder to the customer for ${order.order_number}?`)) return;
      testReminderButton.disabled = true;
      saveMessage.textContent = 'Queueing test reminder…';
      saveMessage.classList.remove('is-error');
      try {
        const { data, error } = await client.rpc('send_test_campaign_order_expiry_reminder', { p_order_id: order.id });
        if (error) throw error;
        saveMessage.textContent = `Test reminder queued for Make (${data?.request_id ?? 'request accepted'}). Check Make/UltraMsg delivery.`;
      } catch (error) {
        console.error(`Could not queue a test reminder for ${order.order_number}.`, error);
        saveMessage.textContent = error.message || 'Could not queue the test reminder.';
        saveMessage.classList.add('is-error');
      } finally {
        testReminderButton.disabled = false;
      }
    });

    const contact = document.createElement('div');
    contact.className = 'order-contact';
    addText(contact, 'p', `Contact WhatsApp: ${order.customer_phone}`);
    if (order.ad_whatsapp) addText(contact, 'p', `Message recipient WhatsApp: ${order.ad_whatsapp}`);
    card.append(contact);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View campaign details';
    details.append(summary);
    details.append(renderCampaignDetails(order.details ?? {}));
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
      adminEmail = session.user.email || '';
      const { data, error } = await client.from('orders').select('*').eq('payment_status', 'paid').order('created_at', { ascending: false }).limit(100);
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
