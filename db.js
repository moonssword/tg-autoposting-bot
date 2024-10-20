require('dotenv').config();
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function getAds(cities, count) {
    // Преобразуем массив городов в строку для использования в SQL-запросе
    const cityPlaceholders = cities.map((_, index) => `$${index + 1}`).join(', ');
    const query = `
        SELECT *
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY city ORDER BY posted_at DESC) AS row_num
            FROM ads
            WHERE is_active = true
            AND is_posted = false
            AND posted_at > NOW() - INTERVAL '1 week'
            AND source = 'parser'
            AND converted_photos IS NOT NULL
            AND city IN (${cityPlaceholders})  -- Ограничиваем выборку по городам
        ) AS ranked_ads
        WHERE row_num <= $${cities.length + 1};  -- Используем $ для подстановки count
    `;

    const values = [...cities, count];  // Значения - это города и количество записей
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

async function markAdAsPosted(adId, messageIds, channelId) {
    const query = `
        UPDATE ads
        SET is_posted = true, tg_posted_date = CURRENT_TIMESTAMP, message_id = $2, tg_channel = $3
        WHERE id = $1;
    `;
    await pool.query(query, [adId, messageIds, channelId]);
}

const DB = {
    getAds,
    getOutdatedAds,
    markAdAsInactive,
    markAdAsPosted,
};

module.exports = DB;