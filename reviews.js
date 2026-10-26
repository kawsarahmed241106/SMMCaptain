(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const reviewList = $('reviewList');
  const reviewForm = $('reviewForm');
  const reviewToggle = $('reviewToggle');
  const reviewStatus = $('reviewStatus');
  const submitButton = $('submitReview');
  if (!reviewList || !reviewForm) return;

  reviewToggle?.addEventListener('click', () => {
    const willOpen = reviewForm.hidden;
    reviewForm.hidden = !willOpen;
    reviewToggle.setAttribute('aria-expanded', String(willOpen));
    reviewToggle.textContent = willOpen ? 'রিভিউ ফর্ম বন্ধ করুন' : 'আপনার রিভিউ দিন';
    if (willOpen) $('reviewWhatsapp').focus();
  });

  async function getClient() {
    const bootstrap = window.smmSupabaseBootstrap;
    if (!bootstrap) throw new Error('Supabase সংযোগ পাওয়া যায়নি।');
    try {
      const { data, error } = await bootstrap.from('site_settings').select('settings').eq('id', 1).maybeSingle();
      const activeKey = data?.settings?.supabasePublishableKey;
      if (!error && activeKey && activeKey !== window.smmSupabaseBootstrapKey && window.createSmmSupabaseClient) {
        window.smmSupabaseClient = window.createSmmSupabaseClient(activeKey);
        return window.smmSupabaseClient;
      }
    } catch (error) {
      console.warn('Could not load the active Supabase key for reviews.', error);
    }
    return window.smmSupabaseClient || bootstrap;
  }

  function showStatus(message, isError = false) {
    reviewStatus.textContent = message;
    reviewStatus.classList.toggle('is-error', isError);
  }

  function renderReviews(reviews) {
    reviewList.replaceChildren();
    if (!reviews?.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = 'এখনো কোনো রিভিউ নেই। আপনার অভিজ্ঞতা প্রথমে শেয়ার করুন।';
      reviewList.append(empty);
      return;
    }

    const dateFormatter = new Intl.DateTimeFormat('bn-BD', {
      dateStyle: 'medium', timeZone: 'Asia/Dhaka'
    });
    reviews.forEach(review => {
      const article = document.createElement('article');
      article.className = 'review-item';
      const head = document.createElement('div');
      head.className = 'review-item-head';
      const author = document.createElement('strong');
      author.textContent = review.reviewer_label || 'SMMCaptain গ্রাহক';
      const date = document.createElement('time');
      date.dateTime = review.created_at;
      date.textContent = dateFormatter.format(new Date(review.created_at));
      head.append(author, date);
      const message = document.createElement('p');
      message.className = 'review-item-message';
      message.textContent = review.review_message;
      article.append(head, message);
      reviewList.append(article);
    });
  }

  async function loadReviews() {
    try {
      const client = await getClient();
      const { data, error } = await client.rpc('list_public_reviews');
      if (error) throw error;
      renderReviews(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Could not load customer reviews.', error);
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = 'রিভিউ লোড করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।';
      reviewList.replaceChildren(empty);
    }
  }

  reviewForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!reviewForm.reportValidity()) return;
    submitButton.disabled = true;
    showStatus('রিভিউ জমা দেওয়া হচ্ছে…');
    try {
      const client = await getClient();
      const { error } = await client.rpc('submit_public_review', {
        p_whatsapp_number: $('reviewWhatsapp').value.trim(),
        p_review_message: $('reviewMessage').value.trim()
      });
      if (error) throw error;
      reviewForm.reset();
      showStatus('ধন্যবাদ! আপনার রিভিউ প্রকাশ করা হয়েছে।');
      await loadReviews();
    } catch (error) {
      console.error('Could not submit customer review.', error);
      showStatus(error.message || 'রিভিউ জমা দেওয়া যায়নি। আবার চেষ্টা করুন।', true);
    } finally {
      submitButton.disabled = false;
    }
  });

  loadReviews();
})();
