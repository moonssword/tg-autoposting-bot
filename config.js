require('dotenv').config();

module.exports = {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    s3domain: process.env.S3_DOMAIN,
    photoType: process.env.PHOTO_TYPE,
    maxPostsInPeriod: parseInt(process.env.MAX_POSTS_IN_PERIOD, 10), // Количество сообщений из 1 итерации массива postTimes
    postIntervalMinutes: parseInt(process.env.POST_INTERVAL_MINUTES, 10), // Интервал межде отправкой сообщений
    cityChannels: JSON.parse(process.env.CITY_CHANNELS), // {"City": "@channel_name OR ID", ...etc}
    postTimes: JSON.parse(process.env.POST_TIMES), // Массив со значениями времени отправки ["08:00", "13:00", "19:00"]
    cronSchedule: process.env.CRON_SCHEDULE,
    dbConfig: {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10),
    }
};
