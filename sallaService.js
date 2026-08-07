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
    return response.data.data || [];
  } catch (error) {
    console.error('Salla Fetch Error Details:', error.response?.data || error.message);
    throw new Error('فشل جلب المنتجات من سلة: ' + (error.response?.data?.error?.message || error.message));
  }
}

async function fetchSingleSallaProduct(query) {
  try {
    const token = await getAccessToken();
    const response = await axios.get(`https://api.salla.dev/admin/v2/products?keyword=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const products = response.data.data || [];
    return products.find(p => String(p.id) === String(query) || p.name.includes(query)) || products[0] || null;
  } catch (error) {
    throw new Error('فشل البحث عن المنتج في سلة');
  }
}

async function updateSallaProductPrice(sallaProductId, calculatedPrice, discountPercent = 0, weight = null) {
  try {
    const token = await getAccessToken();
    const payload = {};

    const basePrice = Number(parseFloat(calculatedPrice).toFixed(2));
    const discount = Number(parseFloat(discountPercent || 0));

    if (discount > 0 && discount < 100) {
      const salePrice = Number((basePrice * (1 - discount / 100)).toFixed(2));
      payload.regular_price = basePrice;
      payload.sale_price = salePrice;
      payload.price = salePrice;
    } else {
      payload.price = basePrice;
      payload.regular_price = basePrice;
      payload.sale_price = null;
    }

    if (weight !== null && parseFloat(weight) > 0) {
      payload.weight = Number(parseFloat(weight).toFixed(3));
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

module.exports = { fetchSallaProducts, fetchSingleSallaProduct, updateSallaProductPrice };
