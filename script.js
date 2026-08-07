const API_BASE_URL = 'https://gold-salla-backend.onrender.com';

async function fetchLiveGoldRates() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/gold-rates`);
        const data = await response.json();

        if (data.success && data.rates) {
            const r = data.rates;
            
            // تحديث قيم الكرت
            if (document.getElementById('rate-ounce-usd')) {
                document.getElementById('rate-ounce-usd').innerText = `$${parseFloat(r.ounce_usd || 0).toLocaleString()}`;
            }
            if (document.getElementById('rate-ounce-sar')) {
                document.getElementById('rate-ounce-sar').innerText = `${parseFloat(r.ounce_sar || 0).toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-24k')) {
                document.getElementById('rate-24k').innerText = `${parseFloat(r.gram_24k || r['24k'] || 0).toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-22k')) {
                document.getElementById('rate-22k').innerText = `${parseFloat(r.gram_22k || r['22k'] || 0).toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-21k')) {
                document.getElementById('rate-21k').innerText = `${parseFloat(r.gram_21k || r['21k'] || 0).toFixed(2)} ر.س`;
            }
            if (document.getElementById('rate-18k')) {
                document.getElementById('rate-18k').innerText = `${parseFloat(r.gram_18k || r['18k'] || 0).toFixed(2)} ر.س`;
            }
        }
    } catch (error) {
        console.error('خطأ أثناء جلب أسعار الذهب:', error);
    }
}

// التشغيل الفوري عند تحميل الملف
fetchLiveGoldRates();

// التحديث التلقائي كل 10 ثوانٍ
setInterval(fetchLiveGoldRates, 10000);
