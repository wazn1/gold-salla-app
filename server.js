// 🌐 رابط السيرفر المعتمد بعد تصحيح الخطأ المطبعي
const API_URL = 'https://gold-salla-backend.onrender.com';
let currentMerchantId = 'DEFAULT_STORE';

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        document.getElementById('login-modal').style.display = 'none';
        loadMerchantInfo();
        loadProducts();
    } else {
        document.getElementById('login-modal').style.display = 'flex';
    }

    // بدء جلب أسعار الذهب المباشرة وتكرارها كل 10 ثوانٍ
    fetchLiveGoldRates();
    setInterval(fetchLiveGoldRates, 10000);
});

// 🔑 تسجيل الدخول وحفظ التوكن
async function submitLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
        errorEl.innerText = 'يرجى إدخال اسم المستخدم وكلمة المرور';
        errorEl.style.display = 'block';
        return;
    }

    errorEl.innerText = 'جاري الاتصال بالسيرفر...';
    errorEl.style.display = 'block';
    errorEl.style.color = '#3182ce';

    try {
        const res = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            localStorage.setItem('auth_token', data.token);
            document.getElementById('login-modal').style.display = 'none';
            loadMerchantInfo();
            loadProducts();
        } else {
            errorEl.style.color = '#e53e3e';
            errorEl.innerText = data.error || 'اسم المستخدم أو كلمة المرور غير صحيحة';
        }
    } catch (err) {
        console.error('Login Fetch Error:', err);
        errorEl.style.color = '#e53e3e';
        errorEl.innerText = 'تعذر الاتصال بالسيرفر. تحقق من حالة السيرفر وحاول مجدداً.';
    }
}

// 🚪 تسجيل الخروج
function logout() {
    localStorage.removeItem('auth_token');
    location.reload();
}

// 📊 جلب أسعار الذهب المباشرة وتحديث شريط الأسعار
async function fetchLiveGoldRates() {
    try {
        const response = await fetch(`${API_URL}/api/gold-rates`);
        const data = await response.json();

        if (data.success && data.rates) {
            const r = data.rates;
            const setEl = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.innerText = val;
            };

            setEl('rate-ounce-usd', `$${parseFloat(r.ounce_usd || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
            setEl('rate-ounce-sar', `${parseFloat(r.ounce_sar || 0).toFixed(2)} ر.س`);
            setEl('rate-24k', `${parseFloat(r.gram_24k || 0).toFixed(2)} ر.س`);
            setEl('rate-22k', `${parseFloat(r.gram_22k || 0).toFixed(2)} ر.س`);
            setEl('rate-21k', `${parseFloat(r.gram_21k || 0).toFixed(2)} ر.س`);
            setEl('rate-18k', `${parseFloat(r.gram_18k || 0).toFixed(2)} ر.س`);
        }
    } catch (error) {
        console.error('خطأ أثناء جلب الأسعار المباشرة:', error);
    }
}

// 👤 جلب معلومات المتجر والاشتراك
async function loadMerchantInfo() {
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch(`${API_URL}/api/merchant/info?merchant_id=${currentMerchantId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.merchant) {
            document.getElementById('user-merchant').innerText = data.merchant.merchant_id;
            const isExpired = new Date(data.merchant.subscription_expires_at) < new Date();
            const statusElem = document.getElementById('user-sub-status');
            statusElem.innerText = isExpired ? 'منتهي' : 'نشط';
            statusElem.className = isExpired ? 'sub-expired' : 'sub-active';
            document.getElementById('user-sub-expiry').innerText = new Date(data.merchant.subscription_expires_at).toLocaleDateString('ar-SA');
        }
    } catch (err) {
        console.error('خطأ جلب بيانات المتجر:', err);
    }
}

// 📦 جلب المنتجات وعرضها في الجدول
async function loadProducts() {
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch(`${API_URL}/api/products?merchant_id=${currentMerchantId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 401 || res.status === 403) return logout();

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const container = document.getElementById('products-list');
        container.innerHTML = '';

        if (data.last_import) document.getElementById('last-import-time').innerText = new Date(data.last_import).toLocaleString('ar-SA');
        if (data.last_update) document.getElementById('last-update-time').innerText = new Date(data.last_update).toLocaleString('ar-SA');

        if (!data.products || data.products.length === 0) {
            container.innerHTML = `<tr><td colspan="10" style="text-align:center;">لا توجد منتجات مخزنة. اضغط على "سحب كافة المنتجات".</td></tr>`;
            return;
        }

        data.products.forEach(p => {
            const tr = document.createElement('tr');
            tr.id = `row-${p.id}`;
            
            const discount = parseFloat(p.discount_percent || 0);
            let priceHtml = `${p.current_price || 0} ر.س`;
            if (discount > 0 && p.original_price) {
                priceHtml = `<span class="old-price">${p.original_price}</span> ${p.current_price} ر.س`;
            }

            const is24k = parseInt(p.karat) === 24;

            tr.innerHTML = `
                <td><strong>${p.name}</strong><br><small style="color:#94a3b8;">ID: ${p.salla_product_id}</small></td>
                <td>
                    <select id="karat-${p.id}" onchange="handleKratChange(${p.id})">
                        <option value="24" ${p.karat == 24 ? 'selected' : ''}>24</option>
                        <option value="22" ${p.karat == 22 ? 'selected' : ''}>22</option>
                        <option value="21" ${p.karat == 21 ? 'selected' : ''}>21</option>
                        <option value="18" ${p.karat == 18 ? 'selected' : ''}>18</option>
                    </select>
                </td>
                <td><input type="number" step="0.001" id="weight-${p.id}" value="${p.weight || 0}"></td>
                <td><input type="number" step="0.5" id="workmanship-${p.id}" value="${p.workmanship_per_gram || 0}"></td>
                <td><input type="number" step="1" id="extra-${p.id}" value="${p.extra_fee || 0}"></td>
                <td><input type="number" step="0.5" id="profit-${p.id}" value="${p.profit_margin_percent || 0}"></td>
                <td><input type="number" step="0.5" id="discount-${p.id}" value="${p.discount_percent || 0}"></td>
                <td style="text-align:center;">
                    <input type="checkbox" id="taxable-${p.id}" ${p.is_taxable && !is24k ? 'checked' : ''} ${is24k ? 'disabled' : ''}>
                </td>
                <td class="badge-price" id="price-${p.id}">${priceHtml}</td>
                <td style="display:flex; gap: 4px;">
                    <button class="btn" onclick="saveProduct(${p.id})">حفظ 💾</button>
                    <button class="btn btn-danger" onclick="deleteProduct(${p.id})">🗑️</button>
                </td>
            `;
            container.appendChild(tr);
        });

    } catch (err) {
        alert('حدث خطأ أثناء جلب المنتجات: ' + err.message);
    }
}

// ⚖️ إلغاء تحديد الضريبة تلقائياً لعيار 24
function handleKratChange(id) {
    const karatSelect = document.getElementById(`karat-${id}`);
    const taxableCheckbox = document.getElementById(`taxable-${id}`);
    
    if (parseInt(karatSelect.value) === 24) {
        taxableCheckbox.checked = false;
        taxableCheckbox.disabled = true;
    } else {
        taxableCheckbox.disabled = false;
    }
}

// 💾 حفظ تعديلات منتج فردي
async function saveProduct(id) {
    const token = localStorage.getItem('auth_token');
    const karatVal = parseInt(document.getElementById(`karat-${id}`).value);
    
    const payload = {
        merchant_id: currentMerchantId,
        metal_type: 'gold',
        karat: karatVal,
        weight: parseFloat(document.getElementById(`weight-${id}`).value),
        workmanship_per_gram: parseFloat(document.getElementById(`workmanship-${id}`).value),
        extra_fee: parseFloat(document.getElementById(`extra-${id}`).value),
        profit_margin_percent: parseFloat(document.getElementById(`profit-${id}`).value),
        discount_percent: parseFloat(document.getElementById(`discount-${id}`).value),
        is_taxable: karatVal === 24 ? false : document.getElementById(`taxable-${id}`).checked
    };

    try {
        const res = await fetch(`${API_URL}/api/products/${id}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            loadProducts();
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        alert('حدث خطأ أثناء الحفظ: ' + err.message);
    }
}

// ⚡ تحديث أسعار جميع المنتجات دفعة واحدة
async function updateAllProducts() {
    if(!confirm('هل تريد حفظ وتحديث جميع المنتجات في سلة دفعة واحدة؟')) return;
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch(`${API_URL}/api/products/update-all`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ merchant_id: currentMerchantId })
        });
        const data = await res.json();
        alert(data.message || 'تم تحديث كافة المنتجات بنجاح');
        loadProducts();
    } catch (err) {
        alert('فشل تحديث كافة المنتجات: ' + err.message);
    }
}

// 🔄 سحب واستيراد كامل المنتجات من سلة
async function importProducts() {
    if(!confirm('هل تريد سحب واستيراد كافة المنتجات من متجرك بسلة؟')) return;
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch(`${API_URL}/api/products/import`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ merchant_id: currentMerchantId })
        });
        const data = await res.json();
        alert(data.message || 'تم سحب المنتجات بنجاح');
        loadProducts();
    } catch (err) {
        alert('فشل سحب المنتجات: ' + err.message);
    }
}

// 🔍 استدعاء منتج فردي عبر الاسم أو الـ ID
async function fetchSingleProduct() {
    const query = document.getElementById('single-fetch-query').value.trim();
    if(!query) return alert('يرجى كتابة عنوان المنتج أو الـ ID الخاص به في سلة');
    const token = localStorage.getItem('auth_token');

    try {
        const res = await fetch(`${API_URL}/api/products/fetch-single`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ query, merchant_id: currentMerchantId })
        });
        const data = await res.json();
        if(data.success) {
            alert(data.message);
            loadProducts();
        } else {
            throw new Error(data.error);
        }
    } catch(err) {
        alert('خطأ في استدعاء المنتج: ' + err.message);
    }
}

// 🗑️ حذف منتج من لوحة التحكم
async function deleteProduct(id) {
    if(!confirm('هل أنت تأكد من حذف هذا المنتج من إدارة التسعير؟')) return;
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch(`${API_URL}/api/products/${id}?merchant_id=${currentMerchantId}`, { 
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if(data.success) {
            document.getElementById(`row-${id}`).remove();
        } else {
            throw new Error(data.error);
        }
    } catch(err) {
        alert('فشل حذف المنتج: ' + err.message);
    }
}
