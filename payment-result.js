(() => {
  const message = document.getElementById('paymentMessage');
  const orderNumber = document.getElementById('paymentOrderNumber');
  const trackLink = document.getElementById('paymentTrackLink');
  const successHelp = document.getElementById('paymentSuccessHelp');
  const retryButton = document.getElementById('retryPaymentButton');
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order_id'); // compatibility for checkout links created before the rollout
  const checkoutId = params.get('checkout_id');
  const invoiceId = params.get('invoice_id');
  const checkoutToken = params.get('checkout_token');
  let retryMode = 'checkout';

  function show(text, number = '', mode = null) {
    message.textContent = text;
    if (number) {
      orderNumber.textContent = `অর্ডার আইডি: ${number}`;
      orderNumber.hidden = false;
      successHelp.hidden = false;
      trackLink.href = `/track/?order_id=${encodeURIComponent(number)}`;
      trackLink.hidden = false;
    } else {
      orderNumber.textContent = '';
      orderNumber.hidden = true;
      successHelp.hidden = true;
      trackLink.hidden = true;
    }
    retryMode = mode;
    retryButton.hidden = !mode;
    retryButton.textContent = mode === 'verify' ? 'পেমেন্টের অবস্থা আবার দেখুন' : 'পেমেন্ট আবার চেষ্টা করুন';
  }

  async function beginPaymentAgain() {
    const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
    if (!client || !checkoutToken) throw new Error('এই পেমেন্ট সেশনের রেফারেন্স পাওয়া যায়নি।');
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error('পেমেন্ট সেশন যাচাই করা যায়নি।');
    if (!sessionData.session) {
      const { error: signInError } = await client.auth.signInAnonymously();
      if (signInError) throw new Error('Supabase Anonymous Sign-Ins চালু করতে হবে।');
    }
    const body = checkoutId
      ? { checkout_id: checkoutId, checkout_token: checkoutToken }
      : { order_id: orderId, checkout_token: checkoutToken };
    const { data, error } = await client.functions.invoke('create-uddoktapay-checkout', { body });
    if (error || !data?.payment_url) throw new Error(data?.error || 'নতুন পেমেন্ট লিংক তৈরি করা যায়নি।');
    const paymentUrl = new URL(data.payment_url);
    if (paymentUrl.protocol !== 'https:') throw new Error('UddoktaPay নিরাপদ পেমেন্ট লিংক দেয়নি।');
    window.location.assign(paymentUrl.href);
  }

  async function verify() {
    if (params.get('payment') === 'cancelled' && !invoiceId) {
      show('পেমেন্ট সম্পন্ন হয়নি। পেমেন্ট সফল না হওয়া পর্যন্ত কোনো অর্ডার জমা হবে না।', '', checkoutToken ? 'checkout' : null);
      return;
    }
    if (!invoiceId || !checkoutToken) {
      show('পেমেন্ট রেফারেন্স পাওয়া যায়নি। এখনো কোনো অর্ডার জমা হয়নি।', '', checkoutToken ? 'checkout' : null);
      return;
    }
    const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
    if (!client) {
      show('পেমেন্ট যাচাইয়ের সংযোগ পাওয়া যায়নি। কিছুক্ষণ পর আবার পেজটি খুলুন।', '', 'verify');
      return;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      show('পেমেন্ট যাচাইয়ের সেশন তৈরি করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।', '', 'verify');
      return;
    }
    if (!sessionData.session) {
      const { error: signInError } = await client.auth.signInAnonymously();
      if (signInError) {
        show('পেমেন্ট যাচাই করতে Supabase Anonymous Sign-Ins চালু থাকা দরকার।', '', 'verify');
        return;
      }
    }
    const { data, error } = await client.functions.invoke('verify-uddoktapay-payment', {
      body: { invoice_id: invoiceId, checkout_token: checkoutToken },
    });
    if (error) {
      show('পেমেন্ট যাচাই করা যায়নি। পেমেন্ট নিশ্চিত না হওয়া পর্যন্ত অর্ডার জমা হবে না।', '', 'verify');
      return;
    }
    if (data?.payment_status === 'paid' && data.order_number) {
      show('পেমেন্ট সফল হয়েছে এবং আপনার অর্ডার সফলভাবে সাবমিট হয়েছে। ধন্যবাদ!', data.order_number);
    } else if (data?.payment_status === 'pending') {
      show('পেমেন্ট যাচাই চলছে। নিশ্চিত না হওয়া পর্যন্ত অর্ডার জমা হবে না। কিছুক্ষণ পর আবার দেখুন।', '', 'verify');
    } else {
      show(data?.error || 'পেমেন্ট সম্পন্ন হয়নি, তাই কোনো অর্ডার জমা হয়নি।', '', 'checkout');
    }
  }

  verify().catch(() => show('পেমেন্ট যাচাই করা যায়নি। এখনো কোনো অর্ডার জমা হয়নি।', '', 'verify'));

  retryButton.addEventListener('click', async () => {
    const mode = retryMode;
    retryButton.disabled = true;
    retryButton.textContent = mode === 'verify' ? 'পেমেন্ট যাচাই হচ্ছে…' : 'প্রক্রিয়াধীন…';
    try {
      if (mode === 'verify') await verify();
      else await beginPaymentAgain();
    } catch (error) {
      show(error.message || 'পেমেন্ট প্রক্রিয়া করা যায়নি।', '', mode || 'checkout');
    } finally {
      retryButton.disabled = false;
    }
  });
})();
