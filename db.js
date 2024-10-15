require('dotenv').config();
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

// Функция для получения новых объявлений для публикации
async function getAds() {
    const query = `
        SELECT * FROM ads
        WHERE is_active = true
        AND is_posted = false
        AND posted_at > NOW() - INTERVAL '1 week'
        ORDER BY posted_at DESC
        LIMIT $1;
    `;
    const values = [config.maxPostsPerUpdate];
    const result = await pool.query(query, values);
    return result.rows;
}

// Функция для получения устаревших объявлений для удаления
async function getOutdatedAds() {
    const query = `
        SELECT ad_id, message_id FROM ads
        WHERE posted_at < NOW() - INTERVAL '4 week'
        AND is_active = true
        AND message_id IS NOT NULL;
    `;
    const result = await pool.query(query);
    return result.rows;
}

// Функция для обновления статуса объявления после удаления
async function markAdAsInactive(adId) {
    const query = `
        UPDATE ads
        SET is_active = false, message_id = NULL
        WHERE id = $1;
    `;
    await pool.query(query, [adId]);
}

async function markAdAsPosted(adId, messageIds) {
    const query = `
        UPDATE ads
        SET is_posted = true, message_id = $1
        WHERE ad_id = $2;
    `;
    await pool.query(query, [messageIds, adId]);
}

const DB = {
    getAds,
    getOutdatedAds,
    markAdAsInactive,
    markAdAsPosted,
};

module.exports = DB;