// Load public-site copy and links maintained in Supabase by the admin page.
(() => {
    const applySettings = (settings) => {
      try {
        const setText = (selector, value) => {
            if (typeof value !== 'string' || !value.trim()) return;
            const element = document.querySelector(selector);
            if (element) element.textContent = value;
        };
        const setLink = (selector, value) => {
            if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return;
            const element = document.querySelector(selector);
            if (element) element.href = value;
        };
        setText('.brand > div:last-child', settings.brandName);
        setText('.topnote', settings.topNote);
        setText('.eyebrow', settings.heroEyebrow);
        setText('.hero h1', settings.heroTitle);
        setText('.hero-inner > div:first-child > p', settings.heroDescription);
        if (Number(settings.dollarRate) >= 1) {
            const rateInput = document.querySelector('#dollarRate');
            if (rateInput) {
                rateInput.value = Number(settings.dollarRate);
                // Keep all pricing surfaces in sync with the admin value. The
                // input event also covers cases where this settings fetch
                // finishes before the main form has finished initializing.
                rateInput.dispatchEvent(new Event('input', { bubbles: true }));
                rateInput.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof window.refreshCampaignPricing === 'function') {
                    window.refreshCampaignPricing();
                } else {
                    window.addEventListener('load', () => {
                        if (typeof window.refreshCampaignPricing === 'function') {
                            window.refreshCampaignPricing();
                        }
                    }, { once: true });
                }
            }
        }
        const rateNote = document.querySelector('#heroExchangeRateNote');
        if (rateNote && typeof settings.exchangeRateNote === 'string') {
            rateNote.textContent = settings.exchangeRateNote;
            rateNote.hidden = !settings.exchangeRateNote.trim();
        }
        setText('#profileLink', settings.profileLabel);
        setLink('#profileLink', settings.profileUrl);
        setLink('#friendRequestBtn', settings.profileUrl);
        if (settings.instructionVideo && /^https?:\/\//i.test(settings.instructionVideo)) {
            const preview = document.querySelector('#videoPreview');
            if (preview) {
                const url = settings.instructionVideo;
                const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i);
                const video = document.createElement(youtube ? 'iframe' : 'video');
                video.src = youtube ? `https://www.youtube-nocookie.com/embed/${youtube[1]}` : url;
                video.controls = true;
                video.title = 'নির্দেশনামূলক ভিডিও';
                video.style.cssText = 'width:100%;height:100%;min-height:220px;border:0;display:block';
                if (youtube) video.allowFullscreen = true;
                preview.replaceChildren(video);
            }
        }
      } catch (error) {
        console.warn('Site settings could not be applied.', error);
      }
    };
    const bootstrapClient = window.smmSupabaseBootstrap || window.smmSupabaseClient;
    const readSettingsFromRest = async () => {
      const url = `${window.smmSupabaseUrl}/rest/v1/site_settings?select=settings&id=eq.1`;
      const key = window.smmSupabaseBootstrapKey;
      const response = await fetch(url, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Settings request failed (${response.status}).`);
      const rows = await response.json();
      return rows[0]?.settings || null;
    };
    const loadSettings = async () => {
      if (bootstrapClient) {
        const { data, error } = await bootstrapClient.from('site_settings').select('settings').eq('id', 1).maybeSingle();
        if (error) throw error;
        if (data?.settings) return data.settings;
      }
      return readSettingsFromRest();
    };
    loadSettings()
      .catch(async (error) => {
        console.warn('Supabase client settings read failed; trying the REST endpoint.', error);
        return readSettingsFromRest();
      })
      .then((settings) => {
        if (!settings) return;
        // The public settings row is readable with the bootstrap key. Applying
        // it directly avoids delaying the page on a redundant second read with
        // the admin-selected key.
        const activeKey = settings.supabasePublishableKey || window.smmSupabaseBootstrapKey;
        if (activeKey && window.createSmmSupabaseClient) {
          window.smmSupabaseClient = window.createSmmSupabaseClient(activeKey);
        }
        applySettings(settings);
      })
      .catch((error) => console.warn('Supabase site settings unavailable; showing page defaults.', error));
})();

const $ = id => document.getElementById(id);
const money = n => '৳' + Math.round(n).toLocaleString('en-US').replace(/,/g, '٬').replace(/٬/g, ',');
const bn = n => Number(n).toLocaleString('bn-BD');
const goalNames = { messages: 'মেসেজ', leads: 'লিড', sales: 'বিক্রয়', traffic: 'ওয়েবসাইট ভিজিট', engagement: 'এনগেজমেন্ট', awareness: 'ব্র্যান্ড পরিচিতি', views: 'ভিডিও ভিউ', app: 'অ্যাপ প্রোমোশন' };
const bdDistricts = {
    'ঢাকা': ['সাভার', 'ধামরাই', 'কেরানীগঞ্জ', 'দোহার', 'নবাবগঞ্জ'], 'ঢাকা মহানগর': ['আদাবর', 'বিমানবন্দর', 'বাড্ডা', 'বনানী', 'বংশাল', 'ভাসানটেক', 'ক্যান্টনমেন্ট', 'চকবাজার', 'দারুস সালাম', 'দক্ষিণখান', 'ডেমরা', 'ধানমন্ডি', 'গেন্ডারিয়া', 'গুলশান', 'হাজারীবাগ', 'যাত্রাবাড়ী', 'কদমতলী', 'কাফরুল', 'কলাবাগান', 'কামরাঙ্গীরচর', 'খিলগাঁও', 'খিলক্ষেত', 'কোতোয়ালি', 'লালবাগ', 'মিরপুর মডেল', 'মোহাম্মদপুর', 'মতিঝিল', 'মুগদা', 'নিউ মার্কেট', 'পল্লবী', 'পল্টন মডেল', 'রমনা মডেল', 'রামপুরা', 'রূপনগর', 'সবুজবাগ', 'শাহ আলী', 'শাহবাগ', 'শেরেবাংলা নগর', 'শ্যামপুর', 'সূত্রাপুর', 'শাহজাহানপুর', 'তেজগাঁও', 'তেজগাঁও শিল্পাঞ্চল', 'তুরাগ', 'উত্তরা মডেল', 'উত্তরখান', 'উত্তরা পশ্চিম', 'ভাটারা', 'ওয়ারী'], 'ফরিদপুর': ['ফরিদপুর সদর', 'আলফাডাঙ্গা', 'বোয়ালমারী', 'ভাঙ্গা', 'নগরকান্দা', 'সদরপুর', 'চরভদ্রাসন', 'মধুখালী', 'সালথা'], 'গাজীপুর': ['গাজীপুর সদর', 'কালিয়াকৈর', 'কালীগঞ্জ', 'কাপাসিয়া', 'শ্রীপুর'], 'গোপালগঞ্জ': ['গোপালগঞ্জ সদর', 'কাশিয়ানী', 'কোটালীপাড়া', 'মুকসুদপুর', 'টুঙ্গিপাড়া'], 'কিশোরগঞ্জ': ['কিশোরগঞ্জ সদর', 'অষ্টগ্রাম', 'বাজিতপুর', 'ভৈরব', 'হোসেনপুর', 'ইটনা', 'করিমগঞ্জ', 'কটিয়াদী', 'কুলিয়ারচর', 'মিঠামইন', 'নিকলী', 'পাকুন্দিয়া', 'তাড়াইল'], 'মাদারীপুর': ['মাদারীপুর সদর', 'কালকিনি', 'রাজৈর', 'শিবচর', 'ডাসার'], 'মানিকগঞ্জ': ['মানিকগঞ্জ সদর', 'দৌলতপুর', 'ঘিওর', 'হরিরামপুর', 'সাটুরিয়া', 'শিবালয়', 'সিংগাইর'], 'মুন্সীগঞ্জ': ['মুন্সীগঞ্জ সদর', 'গজারিয়া', 'লৌহজং', 'সিরাজদিখান', 'শ্রীনগর', 'টংগিবাড়ী'], 'নারায়ণগঞ্জ': ['নারায়ণগঞ্জ সদর', 'আড়াইহাজার', 'বন্দর', 'রূপগঞ্জ', 'সোনারগাঁ'], 'নরসিংদী': ['নরসিংদী সদর', 'বেলাব', 'মনোহরদী', 'পলাশ', 'রায়পুরা', 'শিবপুর'], 'রাজবাড়ী': ['রাজবাড়ী সদর', 'বালিয়াকান্দি', 'গোয়ালন্দ', 'পাংশা', 'কালুখালী'], 'শরীয়তপুর': ['শরীয়তপুর সদর', 'ভেদরগঞ্জ', 'ডামুড্যা', 'গোসাইরহাট', 'নড়িয়া', 'জাজিরা'], 'টাঙ্গাইল': ['টাঙ্গাইল সদর', 'বাসাইল', 'ভুয়াপুর', 'দেলদুয়ার', 'ধনবাড়ী', 'ঘাটাইল', 'গোপালপুর', 'কালিহাতী', 'মধুপুর', 'মির্জাপুর', 'নাগরপুর', 'সখীপুর'],
    'চট্টগ্রাম': ['চট্টগ্রাম সদর', 'আনোয়ারা', 'বাঁশখালী', 'বোয়ালখালী', 'চন্দনাইশ', 'ফটিকছড়ি', 'হাটহাজারী', 'লোহাগাড়া', 'মীরসরাই', 'পটিয়া', 'রাঙ্গুনিয়া', 'রাউজান', 'সন্দ্বীপ', 'সাতকানিয়া', 'সীতাকুণ্ড', 'কর্ণফুলী'], 'কক্সবাজার': ['কক্সবাজার সদর', 'চকরিয়া', 'কুতুবদিয়া', 'মহেশখালী', 'পেকুয়া', 'রামু', 'টেকনাফ', 'উখিয়া', 'ঈদগাঁও'], 'কুমিল্লা': ['কুমিল্লা সদর', 'বরুড়া', 'ব্রাহ্মণপাড়া', 'বুড়িচং', 'চান্দিনা', 'চৌদ্দগ্রাম', 'দাউদকান্দি', 'দেবিদ্বার', 'হোমনা', 'লাকসাম', 'লালমাই', 'মনোহরগঞ্জ', 'মেঘনা', 'মুরাদনগর', 'নাঙ্গলকোট', 'তিতাস'], 'খাগড়াছড়ি': ['খাগড়াছড়ি সদর', 'দিঘীনালা', 'পানছড়ি', 'লক্ষ্মীছড়ি', 'মহালছড়ি', 'মানিকছড়ি', 'মাটিরাঙ্গা', 'রামগড়', 'গুইমারা'], 'চাঁদপুর': ['চাঁদপুর সদর', 'হাইমচর', 'কচুয়া', 'ফরিদগঞ্জ', 'মতলব উত্তর', 'মতলব দক্ষিণ', 'শাহরাস্তি', 'হাজীগঞ্জ'], 'নোয়াখালী': ['নোয়াখালী সদর', 'বেগমগঞ্জ', 'চাটখিল', 'কোম্পানীগঞ্জ', 'হাতিয়া', 'কবিরহাট', 'সেনবাগ', 'সোনাইমুড়ী', 'সুবর্ণচর'], 'ফেনী': ['ফেনী সদর', 'ছাগলনাইয়া', 'দাগনভূঞা', 'পরশুরাম', 'ফুলগাজী', 'সোনাগাজী'], 'ব্রাহ্মণবাড়িয়া': ['ব্রাহ্মণবাড়িয়া সদর', 'আশুগঞ্জ', 'আখাউড়া', 'বাঞ্ছারামপুর', 'কসবা', 'নবীনগর', 'নাসিরনগর', 'সরাইল', 'বিজয়নগর'], 'লক্ষ্মীপুর': ['লক্ষ্মীপুর সদর', 'কমলনগর', 'রায়পুর', 'রামগঞ্জ', 'রামগতি'], 'রাঙামাটি': ['রাঙামাটি সদর', 'বাঘাইছড়ি', 'বরকল', 'কাপ্তাই', 'জুরাছড়ি', 'লংগদু', 'নানিয়ারচর', 'রাজস্থলী', 'বিলাইছড়ি', 'কাউখালী'], 'বান্দরবান': ['বান্দরবান সদর', 'আলীকদম', 'থানচি', 'নাইক্ষ্যংছড়ি', 'রুমা', 'রোয়াংছড়ি', 'লামা'],
    'রাজশাহী': ['রাজশাহী সদর', 'বাঘা', 'বাগমারা', 'চারঘাট', 'দুর্গাপুর', 'গোদাগাড়ী', 'মোহনপুর', 'পবা', 'পুঠিয়া', 'তানোর'], 'চাঁপাইনবাবগঞ্জ': ['চাঁপাইনবাবগঞ্জ সদর', 'গোমস্তাপুর', 'নাচোল', 'ভোলাহাট', 'শিবগঞ্জ'], 'নওগাঁ': ['নওগাঁ সদর', 'আত্রাই', 'বদলগাছী', 'ধামইরহাট', 'মান্দা', 'মহাদেবপুর', 'নিয়ামতপুর', 'পত্নীতলা', 'পোরশা', 'রাণীনগর', 'সাপাহার'], 'নাটোর': ['নাটোর সদর', 'বাগাতিপাড়া', 'বড়াইগ্রাম', 'গুরুদাসপুর', 'লালপুর', 'সিংড়া', 'নলডাঙ্গা'], 'পাবনা': ['পাবনা সদর', 'আটঘরিয়া', 'বেড়া', 'ভাঙ্গুড়া', 'চাটমোহর', 'ফরিদপুর', 'ঈশ্বরদী', 'সাঁথিয়া', 'সুজানগর'], 'বগুড়া': ['বগুড়া সদর', 'আদমদীঘি', 'ধুনট', 'দুপচাঁচিয়া', 'গাবতলী', 'কাহালু', 'নন্দীগ্রাম', 'সারিয়াকান্দি', 'শাজাহানপুর', 'শেরপুর', 'শিবগঞ্জ', 'সোনাতলা'], 'জয়পুরহাট': ['জয়পুরহাট সদর', 'আক্কেলপুর', 'কালাই', 'ক্ষেতলাল', 'পাঁচবিবি'], 'সিরাজগঞ্জ': ['সিরাজগঞ্জ সদর', 'বেলকুচি', 'চৌহালী', 'কামারখন্দ', 'কাজীপুর', 'রায়গঞ্জ', 'শাহজাদপুর', 'তাড়াশ', 'উল্লাপাড়া'],
    'খুলনা': ['খুলনা সদর', 'বটিয়াঘাটা', 'দাকোপ', 'দিঘলিয়া', 'ডুমুরিয়া', 'ফুলতলা', 'কয়রা', 'পাইকগাছা', 'রূপসা', 'তেরখাদা'], 'কুষ্টিয়া': ['কুষ্টিয়া সদর', 'ভেড়ামারা', 'দৌলতপুর', 'খোকসা', 'কুমারখালী', 'মিরপুর'], 'চুয়াডাঙ্গা': ['চুয়াডাঙ্গা সদর', 'আলমডাঙ্গা', 'দামুড়হুদা', 'জীবননগর'], 'ঝিনাইদহ': ['ঝিনাইদহ সদর', 'হরিণাকুণ্ডু', 'কালীগঞ্জ', 'কোটচাঁদপুর', 'মহেশপুর', 'শৈলকুপা'], 'যশোর': ['যশোর সদর', 'অভয়নগর', 'বাঘারপাড়া', 'চৌগাছা', 'ঝিকরগাছা', 'কেশবপুর', 'মণিরামপুর', 'শার্শা'], 'নড়াইল': ['নড়াইল সদর', 'কালিয়া', 'লোহাগড়া'], 'বাগেরহাট': ['বাগেরহাট সদর', 'চিতলমারী', 'ফকিরহাট', 'কচুয়া', 'মোল্লাহাট', 'মোংলা', 'মোরেলগঞ্জ', 'রামপাল', 'শরণখোলা'], 'মাগুরা': ['মাগুরা সদর', 'মহম্মদপুর', 'শালিখা', 'শ্রীপুর'], 'মেহেরপুর': ['মেহেরপুর সদর', 'গাংনী', 'মুজিবনগর'], 'সাতক্ষীরা': ['সাতক্ষীরা সদর', 'আশাশুনি', 'দেবহাটা', 'কলারোয়া', 'কালিগঞ্জ', 'শ্যামনগর', 'তালা'],
    'বরিশাল': ['বরিশাল সদর', 'আগৈলঝাড়া', 'বাবুগঞ্জ', 'বাকেরগঞ্জ', 'বানারীপাড়া', 'গৌরনদী', 'হিজলা', 'মেহেন্দিগঞ্জ', 'মুলাদী', 'উজিরপুর'], 'ভোলা': ['ভোলা সদর', 'বোরহানউদ্দিন', 'চরফ্যাশন', 'দৌলতখান', 'লালমোহন', 'মনপুরা', 'তজুমদ্দিন'], 'ঝালকাঠি': ['ঝালকাঠি সদর', 'কাঁঠালিয়া', 'নলছিটি', 'রাজাপুর'], 'পটুয়াখালী': ['পটুয়াখালী সদর', 'বাউফল', 'দশমিনা', 'দুমকি', 'গলাচিপা', 'কলাপাড়া', 'মির্জাগঞ্জ', 'রাঙ্গাবালী'], 'পিরোজপুর': ['পিরোজপুর সদর', 'ভান্ডারিয়া', 'কাউখালী', 'মঠবাড়িয়া', 'নাজিরপুর', 'নেছারাবাদ', 'ইন্দুরকানী'], 'বরগুনা': ['বরগুনা সদর', 'আমতলী', 'বামনা', 'বেতাগী', 'পাথরঘাটা', 'তালতলী'],
    'সিলেট': ['সিলেট সদর', 'বালাগঞ্জ', 'বিয়ানীবাজার', 'বিশ্বনাথ', 'কোম্পানীগঞ্জ', 'ফেঞ্চুগঞ্জ', 'গোলাপগঞ্জ', 'গোয়াইনঘাট', 'জৈন্তাপুর', 'কানাইঘাট', 'জকিগঞ্জ', 'দক্ষিণ সুরমা', 'ওসমানীনগর'], 'মৌলভীবাজার': ['মৌলভীবাজার সদর', 'বড়লেখা', 'জুড়ী', 'কমলগঞ্জ', 'কুলাউড়া', 'রাজনগর', 'শ্রীমঙ্গল'], 'হবিগঞ্জ': ['হবিগঞ্জ সদর', 'আজমিরীগঞ্জ', 'বাহুবল', 'বানিয়াচং', 'চুনারুঘাট', 'লাখাই', 'মাধবপুর', 'নবীগঞ্জ', 'শায়েস্তাগঞ্জ'], 'সুনামগঞ্জ': ['সুনামগঞ্জ সদর', 'ছাতক', 'দিরাই', 'দোয়ারাবাজার', 'ধর্মপাশা', 'জগন্নাথপুর', 'জামালগঞ্জ', 'তাহিরপুর', 'বিশ্বম্ভরপুর', 'শাল্লা', 'মধ্যনগর'],
    'রংপুর': ['রংপুর সদর', 'বদরগঞ্জ', 'গংগাচড়া', 'কাউনিয়া', 'মিঠাপুকুর', 'পীরগাছা', 'পীরগঞ্জ', 'তারাগঞ্জ'], 'দিনাজপুর': ['দিনাজপুর সদর', 'বিরামপুর', 'বীরগঞ্জ', 'বিরল', 'বোচাগঞ্জ', 'চিরিরবন্দর', 'ফুলবাড়ী', 'ঘোড়াঘাট', 'হাকিমপুর', 'কাহারোল', 'খানসামা', 'নবাবগঞ্জ', 'পার্বতীপুর'], 'গাইবান্ধা': ['গাইবান্ধা সদর', 'ফুলছড়ি', 'গোবিন্দগঞ্জ', 'পলাশবাড়ী', 'সাদুল্লাপুর', 'সাঘাটা', 'সুন্দরগঞ্জ'], 'কুড়িগ্রাম': ['কুড়িগ্রাম সদর', 'ভুরুঙ্গামারী', 'চর রাজিবপুর', 'চিলমারী', 'ফুলবাড়ী', 'নাগেশ্বরী', 'রাজারহাট', 'রৌমারী', 'উলিপুর'], 'লালমনিরহাট': ['লালমনিরহাট সদর', 'আদিতমারী', 'হাতীবান্ধা', 'কালীগঞ্জ', 'পাটগ্রাম'], 'নীলফামারী': ['নীলফামারী সদর', 'ডিমলা', 'ডোমার', 'জলঢাকা', 'কিশোরগঞ্জ', 'সৈয়দপুর'], 'পঞ্চগড়': ['পঞ্চগড় সদর', 'আটোয়ারী', 'বোদা', 'দেবীগঞ্জ', 'তেঁতুলিয়া'], 'ঠাকুরগাঁও': ['ঠাকুরগাঁও সদর', 'বালিয়াডাঙ্গী', 'হরিপুর', 'পীরগঞ্জ', 'রাণীশংকৈল'],
    'ময়মনসিংহ': ['ময়মনসিংহ সদর', 'ভালুকা', 'ধোবাউড়া', 'ফুলবাড়ীয়া', 'গফরগাঁও', 'গৌরীপুর', 'হালুয়াঘাট', 'ঈশ্বরগঞ্জ', 'মুক্তাগাছা', 'নান্দাইল', 'ফুলপুর', 'তারাকান্দা', 'ত্রিশাল'], 'জামালপুর': ['জামালপুর সদর', 'বকশীগঞ্জ', 'দেওয়ানগঞ্জ', 'ইসলামপুর', 'মাদারগঞ্জ', 'মেলান্দহ', 'সরিষাবাড়ী'], 'নেত্রকোনা': ['নেত্রকোনা সদর', 'আটপাড়া', 'বারহাট্টা', 'দুর্গাপুর', 'খালিয়াজুরী', 'কলমাকান্দা', 'কেন্দুয়া', 'মদন', 'মোহনগঞ্জ', 'পূর্বধলা'], 'শেরপুর': ['শেরপুর সদর', 'ঝিনাইগাতী', 'নকলা', 'নালিতাবাড়ী', 'শ্রীবরদী']
};
const countryNames = { BD: 'বাংলাদেশ', AF: 'আফগানিস্তান', AL: 'আলবেনিয়া', DZ: 'আলজেরিয়া', AR: 'আর্জেন্টিনা', AU: 'অস্ট্রেলিয়া', AT: 'অস্ট্রিয়া', BH: 'বাহরাইন', BE: 'বেলজিয়াম', BR: 'ব্রাজিল', CA: 'কানাডা', CN: 'চীন', CY: 'সাইপ্রাস', CZ: 'চেকিয়া', DK: 'ডেনমার্ক', EG: 'মিশর', FI: 'ফিনল্যান্ড', FR: 'ফ্রান্স', DE: 'জার্মানি', GR: 'গ্রিস', HK: 'হংকং', IN: 'ভারত', ID: 'ইন্দোনেশিয়া', IR: 'ইরান', IQ: 'ইরাক', IE: 'আয়ারল্যান্ড', IL: 'ইসরায়েল', IT: 'ইতালি', JP: 'জাপান', JO: 'জর্ডান', KW: 'কুয়েত', LB: 'লেবানন', MY: 'মালয়েশিয়া', MV: 'মালদ্বীপ', MX: 'মেক্সিকো', NP: 'নেপাল', NL: 'নেদারল্যান্ডস', NZ: 'নিউজিল্যান্ড', NG: 'নাইজেরিয়া', NO: 'নরওয়ে', OM: 'ওমান', PK: 'পাকিস্তান', PH: 'ফিলিপাইন', PL: 'পোল্যান্ড', PT: 'পর্তুগাল', QA: 'কাতার', RU: 'রাশিয়া', SA: 'সৌদি আরব', SG: 'সিঙ্গাপুর', ZA: 'দক্ষিণ আফ্রিকা', KR: 'দক্ষিণ কোরিয়া', ES: 'স্পেন', LK: 'শ্রীলঙ্কা', SE: 'সুইডেন', CH: 'সুইজারল্যান্ড', TW: 'তাইওয়ান', TH: 'থাইল্যান্ড', TR: 'তুরস্ক', UA: 'ইউক্রেন', AE: 'সংযুক্ত আরব আমিরাত', GB: 'যুক্তরাজ্য', US: 'যুক্তরাষ্ট্র', VN: 'ভিয়েতনাম', OTHER: 'অন্যান্য দেশ' };
const flags = { OTHER: '🌍' };
const countryFlag = code => [...code.toUpperCase()].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
const isoCountryCodes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW` .split(' ');
const localizedCountryNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['bn'], { type: 'region' })
    : null;
for (const code of isoCountryCodes) {
    if (!countryNames[code]) countryNames[code] = localizedCountryNames?.of(code) || code;
    flags[code] = countryFlag(code);
}
function populateCountryOptions() {
    const select = $('country');
    if (!select) return;
    const orderedCodes = ['BD', ...isoCountryCodes.filter(code => code !== 'BD').sort((a, b) => countryNames[a].localeCompare(countryNames[b], 'bn'))];
    select.replaceChildren(...orderedCodes.map(code => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${flags[code]} ${countryNames[code]}`;
        return option;
    }), Object.assign(document.createElement('option'), { value: 'OTHER', textContent: '🌍 অন্যান্য দেশ' }));
    select.value = 'BD';
}
const genericRegions = { US: ['Alabama', 'Alaska', 'Arizona', 'California', 'Colorado', 'Florida', 'Georgia', 'Hawaii', 'Illinois', 'Massachusetts', 'Michigan', 'New Jersey', 'New York', 'North Carolina', 'Ohio', 'Pennsylvania', 'Texas', 'Virginia', 'Washington'], IN: ['Andhra Pradesh', 'Assam', 'Bihar', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'], NP: ['Bagmati', 'Gandaki', 'Karnali', 'Koshi', 'Lumbini', 'Madhesh', 'Sudurpashchim'], GB: ['England', 'Scotland', 'Wales', 'Northern Ireland'], SA: ['Riyadh', 'Makkah', 'Madinah', 'Eastern Province', 'Asir', 'Tabuk', 'Jazan'], AE: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Fujairah', 'Ras Al Khaimah', 'Umm Al Quwain'], MY: ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu'], CA: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Nova Scotia', 'Ontario', 'Quebec', 'Saskatchewan'], AU: ['New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'], DE: ['Baden-Württemberg', 'Bavaria', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hesse', 'Lower Saxony', 'Saxony', 'Thuringia'], IT: ['Lazio', 'Lombardy', 'Sicily', 'Tuscany', 'Veneto', 'Piedmont'], FR: ['Île-de-France', 'Brittany', 'Normandy', 'Occitanie', 'Provence-Alpes-Côte d’Azur'], OTHER: [] };
const genericAreas = { 'California': ['Los Angeles', 'San Diego', 'San Francisco', 'San Jose'], 'New York': ['New York City', 'Buffalo', 'Rochester'], 'England': ['London', 'Birmingham', 'Manchester', 'Liverpool'], 'West Bengal': ['Kolkata', 'Howrah', 'Siliguri', 'Durgapur'], 'Delhi': ['New Delhi', 'Dwarka', 'Rohini'], 'Bagmati': ['Kathmandu', 'Lalitpur', 'Bhaktapur'], 'Riyadh': ['Riyadh City', 'Al Kharj', 'Diriyah'], 'Dubai': ['Downtown Dubai', 'Deira', 'Bur Dubai', 'Jumeirah'], 'Ontario': ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton'], 'Berlin': ['Mitte', 'Kreuzberg', 'Charlottenburg'], 'Kuala Lumpur': ['Bukit Bintang', 'Cheras', 'Kepong'] };
function updateRegion() {
    const code = $('country').value, bd = code === 'BD';
    $('bangladeshLocationFields').classList.toggle('hidden', !bd);
    if (bd) {
        const firstDistricts = ['সকল জেলা', 'ঢাকা', 'ঢাকা মহানগর'];
        const remainingDistricts = Object.keys(bdDistricts)
            .filter(name => !firstDistricts.includes(name))
            .sort((a, b) => a.localeCompare(b, 'bn'));
        const orderedDistricts = [...firstDistricts, ...remainingDistricts];
        $('district').innerHTML = '<option value="">জেলা নির্বাচন করুন</option>' + orderedDistricts.map(name => `<option>${name}</option>`).join('');
        $('upazila').innerHTML = '<option value="">আগে জেলা নির্বাচন করুন</option>';
    }
    else { const regs = genericRegions[code] || []; $('district').innerHTML = '<option value="">স্টেট / অঞ্চল (ঐচ্ছিক)</option>' + regs.map(x => `<option>${x}</option>`).join(''); $('upazila').innerHTML = '<option value="">শহর / এলাকা (ঐচ্ছিক)</option>'; }
    $('location').placeholder = bd ? 'যেমন: সাভার, আমিনবাজার, আশুলিয়া' : 'আপনার শহর বা এলাকার নাম লিখুন';
    $('sumCountry').textContent = (flags[code] || '🌍') + ' ' + (countryNames[code] || 'অন্যান্য দেশ'); updateAll();
}
function updateUpazilas() {
    if ($('country').value === 'BD') {
        const district = $('district').value;
        if (!district) {
            $('upazila').innerHTML = '<option value="">আগে জেলা নির্বাচন করুন</option>';
        } else if (district === 'সকল জেলা') {
            $('upazila').innerHTML = '<option value="সকল উপজেলা">সকল উপজেলা</option>';
        } else {
            const upazilas = bdDistricts[district] || [];
            $('upazila').innerHTML = '<option value="সকল উপজেলা">সকল উপজেলা</option>' + upazilas.map(name => `<option>${name}</option>`).join('');
        }
    } else {
        const areas = genericAreas[$('district').value] || [];
        $('upazila').innerHTML = '<option value="">শহর / এলাকা (ঐচ্ছিক)</option>' + areas.map(name => `<option>${name}</option>`).join('');
    }
}
function updateAge(changedSlider) {
    const minSlider = $('ageMinSlider'), maxSlider = $('ageMaxSlider');
    let minAge = Number(minSlider.value), maxAge = Number(maxSlider.value);
    if (minAge >= maxAge) {
        if (changedSlider === 'ageMinSlider') minSlider.value = maxAge - 1;
        else maxSlider.value = minAge + 1;
        minAge = Number(minSlider.value); maxAge = Number(maxSlider.value);
    }
    $('ageMin').value = minAge; $('ageMax').value = maxAge;
    $('ageMinDisplay').textContent = minAge.toLocaleString('bn-BD');
    $('ageMaxDisplay').textContent = maxAge === 65 ? '৬৫+' : maxAge.toLocaleString('bn-BD');
    const start = ((minAge - 18) / 47) * 100, end = ((maxAge - 18) / 47) * 100;
    $('ageSliderTrack').style.setProperty('--age-start', `${start}%`);
    $('ageSliderTrack').style.setProperty('--age-end', `${end}%`);
    updateAll();
}
function getDaily() {
    return Math.max(2, Math.min(1000, Number($('dailyBudget').value) || 2));
}
function getDays() {
    return Math.max(1, Number($('customDays').value) || 1);
}
function getChannels() {
    return [...document.querySelectorAll('input[name="channel"]:checked')].map(channel => channel.value);
}
function toast(message) {
    const element = $('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => element.classList.add('hidden'), 3200);
}
function updateBudget() {
    let daily = getDaily(), days = getDays(), rate = Math.max(1, Number($('dollarRate').value) || 150), total = daily * days;
    $('heroExchangeRate').textContent = '৳' + rate.toLocaleString('bn-BD') + ' / $১';
    $('dailyTaka').textContent = money(daily * rate); $('totalUsd').textContent = '$' + total.toLocaleString('en-US'); $('totalTaka').textContent = money(total * rate);
    if ($('paymentAmount')) $('paymentAmount').textContent = money(total * rate);
    updateOrderButtonAmount(total * rate);
    $('sumDaily').textContent = '$' + daily.toLocaleString('en-US'); $('sumTotalUsd').textContent = '$' + total.toLocaleString('en-US'); $('sumTotalTaka').textContent = money(total * rate); $('sumDays').textContent = bn(days) + ' দিন';
    let g = $('goal').value, low = 0, high = 0, unit = 'ফলাফল'; if (g === 'messages') { low = total * 2; high = total * 8; unit = 'মেসেজ' } else if (g === 'views') { low = total * 500; high = total * 2000; unit = 'ভিডিও ভিউ' } else if (g === 'leads') { low = total * .5; high = total * 2; unit = 'লিড' } else if (g === 'sales') { low = total * .2; high = total * 1; unit = 'সম্ভাব্য বিক্রয়' } else if (g === 'engagement') { low = total * 15; high = total * 60; unit = 'এনগেজমেন্ট' } else if (g === 'traffic') { low = total * 5; high = total * 25; unit = 'ক্লিক' } else if (g === 'awareness') { low = total * 500; high = total * 1500; unit = 'সম্ভাব্য রিচ' } else { low = total * 10; high = total * 40; unit = 'অ্যাকশন' }
    $('estimate').textContent = `শুধু পরিকল্পনার নমুনা: আনুমানিক ${Math.round(low).toLocaleString('en-US')}–${Math.round(high).toLocaleString('en-US')} ${unit} হতে পারে। এটি কোনো নিশ্চয়তা বা Meta-এর লাইভ পূর্বাভাস নয়। বাস্তব ফলাফল অডিয়েন্স, কনটেন্ট, প্রতিযোগিতা ও অ্যাকাউন্টের ওপর নির্ভর করবে।`;
}
function updateOrderButtonAmount(amount) {
    const button = $('submitOrderBtn');
    if (!button || button.dataset.busy === 'true') return;
    button.textContent = `৳${Math.round(amount).toLocaleString('bn-BD')} পরিশোধ করে অর্ডার করুন →`;
}

async function ensurePaymentFunctionSession(client) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error('পেমেন্ট সেশন তৈরি করা যায়নি। আবার চেষ্টা করুন।');
    if (sessionData.session) return;
    const { error } = await client.auth.signInAnonymously();
    if (error) {
        console.error('Supabase anonymous sign-in failed.', {
            code: error.code,
            status: error.status,
            message: error.message
        });
        const errorCode = error.code || error.status || 'unknown';
        throw new Error(`Supabase anonymous sign-in ব্যর্থ হয়েছে (${errorCode}): ${error.message}`);
    }
}
function updateGoal() {
    const g = $('goal').value;
    const radios = [...document.querySelectorAll('input[name="goalChoice"]')];
    radios.forEach(option => option.checked = option.value === g);
    const selected = radios.find(option => option.checked)?.closest('.goal-option');
    if (selected) {
        const icon = selected.querySelector('.goal-icon');
        $('goalCurrentIcon').className = icon.className;
        $('goalCurrentIcon').textContent = icon.textContent;
        $('goalCurrentTitle').textContent = selected.querySelector('.goal-copy strong').textContent;
        $('goalCurrentDescription').textContent = selected.querySelector('.goal-copy small').textContent;
        $('goalToggleLabel').textContent = 'লক্ষ্য পরিবর্তন করুন⌄';
    } else {
        $('goalCurrentIcon').className = 'goal-icon';
        $('goalCurrentIcon').textContent = '◎';
        $('goalCurrentTitle').textContent = 'ক্যাম্পেইনের লক্ষ্য নির্বাচন করুন';
        $('goalCurrentDescription').textContent = 'আপনার বিজ্ঞাপন দিয়ে কী ফল চান তা বেছে নিন।';
        $('goalToggleLabel').textContent = 'লক্ষ্য বেছে নিন⌄';
    }
    $('messagingFields').classList.toggle('hidden', g !== 'messages');
    $('leadFields').classList.toggle('hidden', g !== 'leads');
    $('salesFields').classList.toggle('hidden', g !== 'sales');
    $('urlGoalFields').classList.toggle('hidden', !['traffic', 'awareness', 'engagement', 'views', 'app'].includes(g));
    $('sumGoal').textContent = goalNames[g] || 'নির্বাচন করা হয়নি';
    $('previewCta').textContent = g === 'messages' ? 'Send Message' : g === 'leads' ? 'Sign Up' : g === 'sales' ? 'Shop Now' : g === 'views' ? 'Watch Video' : 'Learn More';
    $('previewButton').textContent = g === 'messages' ? 'মেসেজ পাঠান' : g === 'leads' ? 'নিবন্ধন করুন' : g === 'sales' ? 'কিনুন' : g === 'views' ? 'ভিডিও দেখুন' : 'আরও জানুন';
    updateBudget();
}
function updateMessageTemplate() { $('customMessageArea').hidden = $('messageTemplate').value !== '' }
function updateSchedule() {}
function updateWhatsAppField() { const selected = document.querySelector('input[name="channel"][value="WhatsApp"]').checked || document.querySelector('input[name="channel"][value="All"]').checked; $('whatsappNumberField').classList.toggle('hidden', !selected); $('adWhatsappNumber').required = selected }
function updateAll() { updateWhatsAppField(); updateBudget(); updateGoal(); updateMessageTemplate(); let msg = $('customMessage').value.trim() || $('messageTemplate').value || 'আপনার পণ্য বা সার্ভিস সম্পর্কে জানতে এখনই মেসেজ করুন!'; $('previewCopy').textContent = msg; let title = $('goal').value === 'sales' ? 'আপনার পণ্য এখনই দেখুন' : $('goal').value === 'views' ? 'আমাদের ভিডিওটি দেখুন' : 'আপনার ব্যবসা আরও এগিয়ে নিন'; $('previewHeadline').textContent = title }
// Admin settings only need to recalculate pricing; avoid coupling that refresh
// to unrelated form controls that may still be initializing.
window.refreshCampaignPricing = updateBudget;
$('ageMin').value = '18'; $('ageMax').value = '65';
$('country').addEventListener('change', updateRegion);
$('postLink').addEventListener('input', schedulePostPreview);
$('postLink').addEventListener('change', renderPostPreview);
$('goal').addEventListener('change', updateGoal);
$('campaignForm').querySelectorAll('input[name="schedule"]').forEach(option => option.addEventListener('change', updateSchedule));
$('ageMinSlider').addEventListener('input', () => updateAge('ageMinSlider'));
$('ageMaxSlider').addEventListener('input', () => updateAge('ageMaxSlider'));
document.querySelectorAll('input[name="genderChoice"]').forEach(option => option.addEventListener('change', () => {
    if (!option.checked) return;
    $('gender').value = option.value;
    updateAll();
}));
$('messageTemplate').addEventListener('change', () => { updateMessageTemplate(); updateAll() });
$('messageTemplate').addEventListener('input', updateMessageTemplate);
document.querySelectorAll('input[name="goalChoice"]').forEach(option => option.addEventListener('change', () => { if (!option.checked) return; $('goal').value = option.value; $('goal').dispatchEvent(new Event('change', { bubbles: true })) }));
$('goalToggle').addEventListener('click', () => { const options = $('goalOptions'); options.hidden = !options.hidden; $('goalToggle').setAttribute('aria-expanded', String(!options.hidden)); if (!options.hidden) options.querySelector('input:checked')?.focus() });
document.querySelectorAll('input[name="goalChoice"]').forEach(option => option.addEventListener('change', () => { if (!option.checked) return; $('goalOptions').hidden = true; $('goalToggle').setAttribute('aria-expanded', 'false') }));
$('dailyBudget').addEventListener('input', () => { $('dailyCustom').value = $('dailyBudget').value; updateBudget() });
$('dailyCustom').addEventListener('input', () => { let v = Math.max(2, Math.min(1000, Number($('dailyCustom').value) || 2)); $('dailyBudget').value = v; updateBudget() });
['dollarRate', 'customDays', 'gender', 'location', 'interests', 'district', 'upazila', 'messageTemplate', 'customMessage', 'leadOffer', 'salesUrl', 'destinationUrl'].forEach(id => $(id).addEventListener('input', () => { if (id === 'district') updateUpazilas(); updateAll() }));
document.querySelectorAll('.quickday').forEach(b => b.addEventListener('click', () => { $('customDays').value = b.dataset.days; updateAll() }));

document.querySelectorAll('input[name="channel"]').forEach(x => x.addEventListener('change', e => {
    const all = document.querySelector('input[name="channel"][value="All"]');
    const others = [...document.querySelectorAll('input[name="channel"]:not([value="All"])')];
    if (e.target.value === 'All') {
        if (all.checked) others.forEach(x => x.checked = false);
    } else {
        all.checked = false;
        if (others.length && others.every(channel => channel.checked)) {
            others.forEach(channel => channel.checked = false);
            all.checked = true;
        }
    }
    updateWhatsAppField();
    updateAll()
}));
$('copyId').addEventListener('click', async () => { const url = $('friendRequestBtn').href; try { await navigator.clipboard.writeText(url); toast('Facebook আইডি লিংক কপি হয়েছে।') } catch (e) { toast('Facebook ID: ' + url) } });
$('alreadyHasPageAccess').addEventListener('change', event => {
    const alreadyHasAccess = event.currentTarget.checked;
    $('accessInstructions').hidden = alreadyHasAccess;
    event.currentTarget.setAttribute('aria-expanded', String(!alreadyHasAccess));
});
$('scrollBudget').addEventListener('click', () => $('dailyBudget').scrollIntoView({ behavior: 'smooth', block: 'center' }));
function buildOrderDetails() {
    const country = $('country').value;
    return {
        platform: 'Facebook',
        postLink: $('postLink').value.trim(),
        goal: $('goal').value,
        goalLabel: goalNames[$('goal').value],
        messageChannels: getChannels(),
        adWhatsapp: $('adWhatsappNumber').value.trim(),
        messageTemplate: $('messageTemplate').value,
        customMessage: $('customMessage').value.trim(),
        countryCode: country,
        country: `${flags[country] || '🌍'} ${countryNames[country] || 'অন্যান্য দেশ'}`,
        district: $('district').value,
        upazila: $('upazila').value,
        location: $('location').value.trim(),
        gender: { all: 'সবাই', men: 'পুরুষ', women: 'নারী' }[$('gender').value],
        ageMin: Number($('ageMin').value),
        ageMax: Number($('ageMax').value),
        interests: $('interests').value.trim(),
        days: getDays(),
        dailyBudgetUsd: getDaily(),
        totalBudgetUsd: getDaily() * getDays(),
        dollarRate: Number($('dollarRate').value),
        totalBudgetBdt: getDaily() * getDays() * Number($('dollarRate').value),
        schedule: document.querySelector('input[name="schedule"]:checked')?.value || 'all',
        scheduleStart: '',
        scheduleEnd: '',
        leadType: document.querySelector('input[name="leadType"]:checked')?.value || '',
        leadOffer: $('leadOffer').value.trim(),
        salesUrl: $('salesUrl').value.trim(),
        destinationUrl: $('destinationUrl').value.trim(),
        accessConfirmed: $('alreadyHasPageAccess').checked || $('accessConfirm').checked,
        termsAccepted: $('terms').checked
    };
}

let pendingPaymentOrder = null;

async function startUddoktaPayment(order) {
    const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
    if (!client) throw new Error('Supabase সংযোগ পাওয়া যায়নি।');
    await ensurePaymentFunctionSession(client);
    const { data, error } = await client.functions.invoke('create-uddoktapay-checkout', {
        body: { checkout_id: order.checkout_id, checkout_token: order.checkout_token }
    });
    if (error) {
        let message = data?.error;
        if (!message && error.context && typeof error.context.clone === 'function') {
            const responseBody = await error.context.clone().json().catch(() => null);
            message = responseBody?.error || responseBody?.message;
        }
        console.error('UddoktaPay checkout function failed.', {
            message: message || error.message,
            status: error.context?.status
        });
        throw new Error(message || `পেমেন্ট সার্ভার অনুরোধটি গ্রহণ করেনি (${error.context?.status || 'network error'}).`);
    }
    if (!data?.payment_url) throw new Error(data?.error || 'UddoktaPay পেমেন্ট লিংক দেয়নি।');
    const paymentUrl = new URL(data.payment_url);
    if (paymentUrl.protocol !== 'https:') throw new Error('UddoktaPay নিরাপদ পেমেন্ট লিংক দেয়নি।');
    window.location.assign(paymentUrl.href);
}

function showPaymentRetry(order, error) {
    $('modalTitle').textContent = 'পেমেন্ট সম্পন্ন হয়নি';
    $('modalDescription').textContent = `পেমেন্ট লিংক তৈরি করা যায়নি: ${error.message || 'কিছুক্ষণ পর আবার চেষ্টা করুন।'} পেমেন্ট সম্পন্ন না হওয়া পর্যন্ত অর্ডার জমা হবে না।`;
    $('successOrderNumber').textContent = '';
    $('successOrderNumber').classList.add('hidden');
    $('successTrackLink').classList.add('hidden');
    $('retryPaymentBtn').classList.remove('hidden');
    $('modalBack').classList.remove('hidden');
}

function focusAndReveal(control) {
    if (!control) return;
    const target = control.closest('.field, .card, .accessbox') || control;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    control.focus({ preventScroll: true });
}

function focusFirstInvalidRequiredField(form) {
    const invalid = [...form.querySelectorAll('[required]')].find(control =>
        !control.disabled && control.getClientRects().length > 0 && !control.checkValidity()
    );
    if (!invalid) return false;
    focusAndReveal(invalid);
    invalid.reportValidity();
    return true;
}

function getPostPreview(link) {
    let url;
    try { url = new URL(link); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const isHost = domain => host === domain || host.endsWith(`.${domain}`);

    if (isHost('youtube.com') || host === 'youtu.be') {
        const videoId = host === 'youtu.be'
            ? url.pathname.split('/').filter(Boolean)[0]
            : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
        if (videoId && /^[\w-]{11}$/.test(videoId)) {
            return { src: `https://www.youtube-nocookie.com/embed/${videoId}`, title: 'YouTube ভিডিও', kind: 'youtube', sourceUrl: url.href };
        }
    }

    if (isHost('facebook.com') || host === 'fb.watch') {
        if (/\/share\/(?:v|r)\//i.test(url.pathname)) {
            return { resolveFacebookShare: true, sourceUrl: url.href };
        }
        const videoPost = host === 'fb.watch' || /\/(?:videos?|watch|reel|reels)\//i.test(url.pathname) || /\/share\/(?:v|r)\//i.test(url.pathname);
        const plugin = videoPost ? 'video.php' : 'post.php';
        const params = new URLSearchParams({ href: url.href, show_text: 'true', width: '500', adapt_container_width: 'true' });
        return { src: `https://www.facebook.com/plugins/${plugin}?${params}`, title: 'Facebook পোস্ট বা ভিডিও', kind: 'post', sourceUrl: url.href };
    }

    if (isHost('instagram.com')) {
        const post = url.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]+)/i);
        if (post) return { src: `https://www.instagram.com/${post[1]}/${post[2]}/embed/`, title: 'Instagram পোস্ট বা Reel', kind: 'post', sourceUrl: url.href };
    }

    if (isHost('tiktok.com')) {
        const videoId = url.pathname.match(/\/video\/(\d+)/)?.[1];
        if (videoId) return { src: `https://www.tiktok.com/player/v1/${videoId}?description=1`, title: 'TikTok ভিডিও', kind: 'video', sourceUrl: url.href };
    }
    if (/^(?:vt|vm)\.tiktok\.com$/.test(host)) {
        return { message: 'TikTok-এর সংক্ষিপ্ত লিংকটি সরাসরি প্রিভিউ করা যায় না। ভিডিওটি খুলে পূর্ণ TikTok লিংকটি কপি করে দিন।' };
    }
    return { message: 'এই লিংকের প্রিভিউ সমর্থিত নয়। Facebook, Instagram, TikTok বা YouTube-এর একটি পাবলিক লিংক দিন।' };
}

let postPreviewSequence = 0;

function showPostPreviewMessage(content, text, sourceUrl = '') {
    const message = document.createElement('p');
    message.className = 'post-preview-placeholder';
    message.textContent = text;
    content.append(message);
    if (sourceUrl) {
        const sourceLink = document.createElement('a');
        sourceLink.className = 'post-preview-source-link';
        sourceLink.href = sourceUrl;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener noreferrer';
        sourceLink.textContent = 'Facebook-এ ভিডিওটি খুলুন ↗';
        content.append(sourceLink);
    }
}

async function renderPostPreview() {
    const sequence = ++postPreviewSequence;
    const content = $('postPreviewContent');
    const media = $('adPreviewMedia');
    const fallback = $('adPreviewFallback');
    const link = $('postLink').value.trim();
    content.replaceChildren();
    if (!link) {
        media.classList.remove('has-post-preview');
        content.hidden = true;
        fallback.hidden = false;
        return;
    }
    media.classList.add('has-post-preview');
    content.hidden = false;
    fallback.hidden = true;

    let preview = getPostPreview(link);
    if (!preview) {
        showPostPreviewMessage(content, 'প্রিভিউ দেখতে একটি সঠিক পোস্ট বা ভিডিও লিংক দিন।');
        return;
    }
    if (preview.resolveFacebookShare) {
        showPostPreviewMessage(content, 'Facebook ভিডিওর সরাসরি লিংক খোঁজা হচ্ছে…');
        const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
        if (!client) {
            content.replaceChildren();
            showPostPreviewMessage(content, 'Facebook-এর সরাসরি ভিডিও লিংক পাওয়া যায়নি।', link);
            return;
        }
        try {
            const { data, error } = await client.functions.invoke('resolve-facebook-share', { body: { url: link } });
            if (sequence !== postPreviewSequence || $('postLink').value.trim() !== link) return;
            if (error || !data?.resolved_url) {
                content.replaceChildren();
                showPostPreviewMessage(content, data?.error || 'Facebook এই শেয়ার লিংক থেকে পাবলিক ভিডিও লিংক দেয়নি। ভিডিওটি পাবলিক কি না যাচাই করুন।', link);
                return;
            }
            preview = getPostPreview(data.resolved_url);
            if (!preview || preview.resolveFacebookShare || !preview.src) {
                content.replaceChildren();
                showPostPreviewMessage(content, 'Facebook একটি ব্যবহারযোগ্য ভিডিও প্রিভিউ লিংক দেয়নি।', link);
                return;
            }
        } catch (error) {
            if (sequence !== postPreviewSequence) return;
            content.replaceChildren();
            showPostPreviewMessage(content, error?.message || 'Facebook ভিডিওর লিংক যাচাই করা যায়নি।', link);
            return;
        }
    }
    if (preview.message) {
        const message = document.createElement('p');
        message.className = 'post-preview-placeholder';
        message.textContent = preview.message;
        content.append(message);
        return;
    }

    const frame = document.createElement('iframe');
    frame.src = preview.src;
    frame.title = preview.title;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen; web-share';
    frame.allowFullscreen = true;
    frame.className = `post-preview-frame-${preview.kind}`;
    content.append(frame);

    const sourceLink = document.createElement('a');
    sourceLink.className = 'post-preview-source-link';
    sourceLink.href = preview.sourceUrl;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = 'প্রিভিউ না দেখালে মূল পোস্ট / ভিডিও খুলুন ↗';
    content.append(sourceLink);
}

let postPreviewTimer;
function schedulePostPreview() {
    clearTimeout(postPreviewTimer);
    postPreviewTimer = setTimeout(renderPostPreview, 450);
}

$('campaignForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (focusFirstInvalidRequiredField(event.currentTarget)) return;
    if (!$('goal').value) {
        $('goalOptions').hidden = false;
        $('goalToggle').setAttribute('aria-expanded', 'true');
        toast('অর্ডার করার আগে একটি ক্যাম্পেইন লক্ষ্য নির্বাচন করুন।');
        focusAndReveal($('goalToggle'));
        $('goalOptions').querySelector('input[name="goalChoice"]')?.focus({ preventScroll: true });
        return;
    }
    if (Number($('ageMin').value) > Number($('ageMax').value)) { toast('বয়সের রেঞ্জ ঠিক করুন।'); focusAndReveal($('ageMinSlider')); return; }
    if (getDaily() * getDays() < 10) { toast('মোট বিজ্ঞাপন বাজেট কমপক্ষে $১০ হতে হবে।'); focusAndReveal($('dailyBudget')); return; }
    if (!/^https?:\/\//i.test($('postLink').value)) { toast('সঠিক পোস্ট/ভিডিও লিংক দিন।'); focusAndReveal($('postLink')); return; }
    if (!$('alreadyHasPageAccess').checked && !$('accessConfirm').checked) { toast('অ্যাক্সেস দেওয়ার নির্দেশনা অনুসরণ করে নিশ্চিত করুন।'); focusAndReveal($('accessConfirm')); return; }
    if (!getChannels().length && $('goal').value === 'messages') { toast('অন্তত একটি মেসেজ চ্যানেল নির্বাচন করুন।'); focusAndReveal(document.querySelector('input[name="channel"]')); return; }

    const formattedPhone = getFormattedPhoneNumber();
    if (formattedPhone.length < 8 || formattedPhone.length > 15) {
        toast('সঠিক WhatsApp নম্বর দিন।'); focusAndReveal($('phone')); return;
    }

    const button = $('submitOrderBtn');
    button.disabled = true;
    button.dataset.busy = 'true';
    button.textContent = 'প্রক্রিয়াধীন…';
    pendingPaymentOrder = null;
    try {
        const client = window.smmSupabaseClient || window.smmSupabaseBootstrap;
        if (!client) throw new Error('Supabase সংযোগ পাওয়া যায়নি। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।');
        await ensurePaymentFunctionSession(client);
        const details = buildOrderDetails();
        const { data, error } = await client.rpc('create_campaign_checkout_intent', {
            p_customer_phone: formattedPhone,
            p_ad_whatsapp: $('adWhatsappNumber').value.trim(),
            p_details: details
        });
        if (error) throw error;
        const order = Array.isArray(data) ? data[0] : data;
        if (!order?.checkout_id || !order?.checkout_token) throw new Error('নিরাপদ পেমেন্ট রেফারেন্স তৈরি হয়নি।');
        pendingPaymentOrder = order;
        await startUddoktaPayment(order);
    } catch (error) {
        console.error('Order or payment setup failed.', error);
        if (pendingPaymentOrder) showPaymentRetry(pendingPaymentOrder, error);
        else toast(`অর্ডার জমা হয়নি: ${error.message || 'আবার চেষ্টা করুন।'}`);
    } finally {
        button.disabled = false;
        button.dataset.busy = 'false';
        updateOrderButtonAmount(getDaily() * getDays() * Math.max(1, Number($('dollarRate').value) || 150));
    }
});

$('retryPaymentBtn').addEventListener('click', async () => {
    if (!pendingPaymentOrder) return;
    const retryButton = $('retryPaymentBtn');
    retryButton.disabled = true;
    retryButton.textContent = 'প্রক্রিয়াধীন…';
    try {
        await startUddoktaPayment(pendingPaymentOrder);
    } catch (error) {
        console.error('Could not retry UddoktaPay checkout.', error);
        showPaymentRetry(pendingPaymentOrder, error);
    } finally {
        retryButton.disabled = false;
        retryButton.textContent = 'পেমেন্ট আবার চেষ্টা করুন';
    }
});

function getFormattedPhoneNumber() {
    const countryCode = $('phoneCountryCode').value;
    let phoneNumber = $('phone').value.trim().replace(/\D/g, '');
    const cleanCountryCode = countryCode.replace(/\D/g, '');

    // Keep a number that already includes the selected country code as entered.
    if (phoneNumber.startsWith(cleanCountryCode)) return phoneNumber;

    // Bangladesh mobile numbers are commonly entered with a leading trunk zero.
    if (cleanCountryCode === '880' && phoneNumber.startsWith('0')) {
        phoneNumber = phoneNumber.substring(1);
    }

    return cleanCountryCode + phoneNumber;
}

$('closeModal').addEventListener('click', () => $('modalBack').classList.add('hidden'));
$('modalBack').addEventListener('click', e => { if (e.target === $('modalBack')) $('modalBack').classList.add('hidden') });
$('previewButton').addEventListener('click', () => toast('এটি শুধু বিজ্ঞাপনের প্রিভিউ—কোনো বিজ্ঞাপন প্রকাশ হয়নি।'));
populateCountryOptions(); updateAge(); updateWhatsAppField(); updateSchedule(); updateRegion(); updateGoal(); updateRadiusShortcutState();
