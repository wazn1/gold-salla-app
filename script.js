const API_BASE_URL = 'https://gold-salla-backend.onrender.com';

async function fetchLiveGoldRates() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/gold-rates`);
        const data = await response.json();

        if (data.success && data.rates) {
            const r = data.rates;

            // 1. سعر الأونصة بالدولار والريال
            const ounceUsd = parseFloat(r.ounce_usd || r.ounceUsd || r.price || 0);
            const ounceSar = parseFloat(r.ounce_sar || r.ounceSar || (ounceUsd * 3.75) || 0);

            // 2. أسعار العيارات بالريال
            const g24 = parseFloat(r.gram_24k || r['24k'] || r.price_gram_24k || (ounceSar / 31.1035) || 0);
            const g22 = parseFloat(r.gram_22k || r['22k'] || r.price_gram_22k || (g24 * (22/24)) || 0);
            const g21 = parseFloat(r.gram_21k || r['21k'] || r.price_gram_21k || (g24 * (21/24)) || 0);
            const g18 = parseFloat(r.gram_18k || r['18k'] || r.price_gram_18k || (g24 * (18/24)) || 0);

            // 3. تحديث العناصر في الواجهة
            if (document.getElementById('rate-ounce-usd')) {
                document.getElementById('rate-ounce-usd').innerText = `$${ounceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            }
            if (document.getElementById('rate-ounce-sar')) {
                document.getElementById('rate-ounce-sar').innerText = `${ounceSar.toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-24k')) {
                document.getElementById('rate-24k').innerText = `${g24.toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-22k')) {
                document.getElementById('rate-22k').innerText = `${g22.toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-21k')) {
                document.getElementById('rate-21k').innerText = `${g21.toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-18k')) {
                document.getElementById('rate-18k').innerText = `${g18.toFixed(2)} ر.س`;
            }
        }
    } catch (error) {
        console.error('خطأ أثناء جلب أسعار الذهب:', error);
    }
}

// التشغيل الفوري عند الفتح
fetchLiveGoldRates();

// التحديث كل 10 ثوانٍ
setInterval(fetchLiveGoldRates, 10000);
