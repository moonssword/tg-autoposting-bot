require('dotenv').config();

module.exports = {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    s3domain: process.env.S3_DOMAIN,
    maxPostsPerUpdate: parseInt(process.env.MAX_POSTS_PER_UPDATE, 10),
    postIntervalMinutes: parseInt(process.env.POST_INTERVAL_MINUTES, 10),
    dbConfig: {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10),
    },
    cityChannels: JSON.parse(process.env.CITY_CHANNELS),
    postTimes: JSON.parse(process.env.POST_TIMES)
};
