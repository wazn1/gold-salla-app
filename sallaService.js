const axios = require('axios');
const db = require('./db');

async function getSallaToken() {
    const res = await db.query('SELECT access_token FROM store_settings LIMIT 1');
    return res.rows[0]?.access_token;
}

async function fetchSallaProducts() {
    const token = await getSallaToken();
    if (!token) throw new Error("لا يوجد Access Token لمنصة سلة");

    const response = await axios.get('https://api.salla.dev/admin/v2/products', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data.data;
}

async function updateSallaProductPrice(sallaProductId, newPrice) {
    const token = await getSallaToken();
    if (!token) throw new Error("لا يوجد Access Token لمنصة سلة");

    await axios.put(`https://api.salla.dev/admin/v2/products/${sallaProductId}`, {
        price: newPrice
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

module.exports = { fetchSallaProducts, updateSallaProductPrice };

