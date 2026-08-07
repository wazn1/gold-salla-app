const axios = require('axios');
const db = require('./db');

async function getAccessToken() {
  const { rows } = await db.query('SELECT access_token FROM store_settings ORDER BY id DESC LIMIT 1');
  if (rows.length === 0) {
    throw new Error('لم يتم العثور على Access Token في قاعدة البيانات');
  }
  return rows[0].access_token;
}

async function fetchSallaProducts() {
  try {
    const token = await getAccessToken();
    const response = await axios.get('https://api.salla.dev/admin/v2/products', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // إرجاع مصفوفة المنتجات من استجابة سلة
    return response.data.data || [];
  } catch (error) {
    console.error('Salla Fetch Error Details:', error.response?.data || error.message);
    throw new Error('فشل جلب المنتجات من سلة: ' + (error.response?.data?.error?.message || error.message));
  }
}

// تحديث السعر والوزن معاً في سلة
async function updateSallaProductPrice(sallaProductId, newPrice, weight = null) {
  try {
    const token = await getAccessToken();
    const payload = {
      price: newPrice
    };

    // إرسال الوزن إلى سلة فقط في حال كان أكبر من 0
    if (weight !== null && parseFloat(weight) > 0) {
      payload.weight = parseFloat(weight);
    }

    await axios.put(`https://api.salla.dev/admin/v2/products/${sallaProductId}`, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Salla Update Price/Weight Error:', error.response?.data || error.message);
    throw new Error('فشل تحديث السعر أو الوزن في سلة');
  }
}

module.exports = { fetchSallaProducts, updateSallaProductPrice };
