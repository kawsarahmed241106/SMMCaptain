(() => {
  const message = document.getElementById('paymentMessage');
  const orderNumber = document.getElementById('paymentOrderNumber');
  const trackLink = document.getElementById('paymentTrackLink');
  const retryButton = document.getElementById('retryPaymentButton');
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order_id');
  const orderNumberFromUrl = params.get('order_number');
  const invoiceId = params.get('invoice_id');
  const checkoutToken = params.get('checkout_token');

  function show(text, number, allowRetry = false) {
    message.textContent = text;
    if (number) {
      orderNumber.textContent = number;
      orderNumber.hidden = false;
      trackLink.href = `/track/?order_id=${encodeURIComponent(number)}`;
      trackLink.hidden = false;
    }
    retryButton.hidden = !allowRetry;
  }

  async function beginPaymentAgain() {
    const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
    if (!client || !orderId || !checkoutToken) throw new Error('এই অর্ডারের পেমেন্ট রেফারেন্স পাওয়া যায়নি।');
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error('পেমেন্ট সেশন যাচাই করা যায়নি।');
    if (!sessionData.session) {
      const { error: signInError } = await client.auth.signInAnonymously();
      if (signInError) throw new Error('Supabase Anonymous Sign-Ins চালু করতে হবে।');
    }
    const { data, error } = await client.functions.invoke('create-uddoktapay-checkout', {
      body: { order_id: orderId, checkout_token: checkoutToken },
    });
    if (error || !data?.payment_url) throw new Error(data?.error || 'নতুন পেমেন্ট লিংক তৈরি করা যায়নি।');
    const paymentUrl = new URL(data.payment_url);
    if (paymentUrl.protocol !== 'https:') throw new Error('UddoktaPay নিরাপদ পেমেন্ট লিংক দেয়নি।');
    window.location.assign(paymentUrl.href);
  }

  async function verify() {
    if (params.get('payment') === 'cancelled') {
      show('পেমেন্ট সম্পন্ন হয়নি। চাইলে একই অর্ডারের জন্য আবার চেষ্টা করুন।', orderNumberFromUrl, true);
      return;
    }
    if (!invoiceId || !checkoutToken) {
      show('পেমেন্ট রেফারেন্স পাওয়া যায়নি। অর্ডার ট্র্যাক পেজে অর্ডারের অবস্থা দেখুন।', orderNumberFromUrl, Boolean(orderId && checkoutToken));
      return;
    }
    const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
    if (!client) {
      show('পেমেন্ট যাচাইয়ের সংযোগ পাওয়া যায়নি। কিছুক্ষণ পর আবার পেজটি খুলুন।');
      return;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      show('পেমেন্ট যাচাইয়ের সেশন তৈরি করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।');
      return;
    }
    if (!sessionData.session) {
      const { error: signInError } = await client.auth.signInAnonymously();
      if (signInError) {
        show('পেমেন্ট যাচাই করতে Supabase Anonymous Sign-Ins চালু থাকা দরকার।');
        return;
      }
    }
    const { data, error } = await client.functions.invoke('verify-uddoktapay-payment', {
      body: { invoice_id: invoiceId, checkout_token: checkoutToken },
    });
    if (error) {
      show('পেমেন্ট যাচাই করা যায়নি। অর্ডার নম্বর দিয়ে ট্র্যাক পেজে অবস্থা দেখুন।');
      return;
    }
    const status = data?.payment_status;
    const number = data?.order_number;
    if (status === 'paid') show('পেমেন্ট সফল হয়েছে। ধন্যবাদ!', number);
    else if (status === 'pending') show('পেমেন্ট এখনও যাচাই হচ্ছে। কিছুক্ষণ পর আবার দেখুন।', number, true);
    else show(data?.error || 'পেমেন্ট সম্পন্ন হয়েছে বলে নিশ্চিত হওয়া যায়নি।', number, true);
  }

  verify().catch(() => show('পেমেন্ট যাচাই করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন.'));

  retryButton.addEventListener('click', async () => {
    retryButton.disabled = true;
    retryButton.textContent = 'পেমেন্ট লিংক তৈরি হচ্ছে…';
    try {
      await beginPaymentAgain();
    } catch (error) {
      show(error.message || 'পেমেন্ট লিংক তৈরি করা যায়নি।', orderNumberFromUrl, true);
    } finally {
      retryButton.disabled = false;
      retryButton.textContent = 'পেমেন্ট আবার চেষ্টা করুন';
    }
  });
})();
