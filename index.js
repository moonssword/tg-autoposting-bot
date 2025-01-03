require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const DB = require('./db');
const cron = require('node-cron');
const moment = require('moment');
const AWS = require('aws-sdk');

const bot = new TelegramBot(config.telegramBotToken, { polling: true });
const s3 = new AWS.S3();

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//postAds();

// Функция для отправки объявлений
async function postAds() {
    const maxPosts = config.maxPostsInPeriod;
    const channels = config.cityChannels;

    const cities = Object.keys(channels);
    const adsByCity = await DB.getAds(cities, maxPosts);

    const groupedAdsByCity = adsByCity.reduce((acc, ad) => {
        const city = ad.city.trim();
        if (!acc[city]) {
            acc[city] = [];
        }
        acc[city].push(ad);
        return acc;
    }, {});
    
    const logMessage = Object.entries(groupedAdsByCity)
    .map(([city, ads]) => `${city}: ${ads.length}`)
    .join('; ');

    console.log(logMessage);

        for (let i = 0; i < maxPosts; i++) {
        setTimeout(async () => {
            for (const [city, ads] of Object.entries(groupedAdsByCity)) {
                const channelId = channels[city];
                
                if (!channelId || ads.length === 0 || ads[i] === undefined) continue;
                const ad = ads[i];

                try {
                    const message = generateAdMessage(ad);
        
                    let mediaGroup;
                    if (config.photoType === 'original_with_wm') {
                        const photoURLs = ad.photos.slice(0, 10);
                        mediaGroup = photoURLs.map((url, index) => ({
                            type: 'photo',
                            media: url,
                            caption: index === 0 ? message : '',
                            parse_mode: 'Markdown'
                        }));
                    } else if (config.photoType === 'converted') {
                        const photoNames = ad.converted_photos.slice(0, 10);
                        mediaGroup = photoNames.map((name, index) => ({
                            type: 'photo',
                            media: `${config.s3domain}/images/${name}`,
                            caption: index === 0 ? message : '',
                            parse_mode: 'Markdown'
                        }));
                    } else {
                        const photoURLs = ad.converted_photos.slice(0, 10);
                        mediaGroup = photoURLs.map((url, index) => ({
                            type: 'photo',
                            media: url,
                            caption: index === 0 ? message : '',
                            parse_mode: 'Markdown'
                        }));
                    }

                    const messageGroup = await bot.sendMediaGroup(channelId, mediaGroup);
        
                    // Сохраняем message_id в базе данных и помечаем объявление опубликованным
                    const messageIds = messageGroup.map(message => message.message_id);
                    await DB.markAdAsPosted(ad.id, messageIds, channelId);
        
                    await delay(5000);
                } catch (error) {
                    console.error('Ошибка при отправке объявления:', error);
                }
            }
        }, i * config.postIntervalMinutes * 60 * 1000);
    }
}

// Функция для формирования сообщения
function generateAdMessage(ad) {
    const roomTypeText = ad.room_type === 'room' ? '' : ad.room_type === 'bed_space' ? ' (койко-место)' : '';
    const roomLocationText = ad.room_location === 'apartment' ? '' :
                             ad.room_location === 'hostel' ? 'в хостеле' :
                             ad.room_location === 'hotel' ? 'в гостинице' : '';

    const messageParts = [
        `🏠 *Сдается* ${ad.house_type === 'apartment' ? ad.rooms + '-комн.квартира' : ad.house_type === 'room' ? 'комната' + roomTypeText + (roomLocationText ? ' ' + roomLocationText : '') : 'дом'} ${ad.duration === 'long_time' ? 'на длительный срок' : 'посуточно'}${ad.area ? ', ' + ad.area + ' м²' : ''}${ad.floor_current ? `, ${ad.floor_current}${ad.floor_total ? '/' + ad.floor_total : ''} этаж` : ''}${ad.bed_capacity ? ', спальных мест - ' + ad.bed_capacity : ''}`,
        `*Адрес:* г.${ad.city}, ${ad.district ? ad.district + ' р-н' : ''} ${ad.microdistrict ? ', ' + ad.microdistrict : ''} ${ad.address ? ', ' + ad.address : ''}`,
        `*Сдает:* ${ad.author === 'Хозяин недвижимости' || ad.author === 'owner' ? 'собственник' : 'посредник'}`,
        `*Цена:* ${ad.price} ₸`,
        `*Контакты:* ${ad.phone} ${[ad.whatsapp ? `[WhatsApp](https://api.whatsapp.com/send?phone=${ad.phone})` : '', ad.tg_username ? `[Telegram](https://t.me/${ad.tg_username})` : ''].filter(Boolean).join(' ')}`,
        `🛋️ *Удобства*: ${[
            ad.toilet ? ad.toilet : '',
            ad.bathroom ? ad.bathroom : '',
            ad.furniture ? ad.furniture : '',
            ad.facilities ? ad.facilities : ''
        ].filter(Boolean).join(', ')}`,
        ad.rental_options ? `📜 *Правила заселения*: ${ad.rental_options}` : '',
        ad.condition ? `🧱 *Состояние*: ${ad.condition == 'дизайнерский' ? 'дизайнерский ремонт' : ad.condition }` : '',
        `📝 *Описание*:\n${ad.description ? ad.description : ''}`,
    ];

    const message = messageParts.filter(Boolean).join('\n');                            

    const trimmedMessage = message.length > 1024 
                        ? message.substring(0, message.lastIndexOf(' ', 1024)) + '...' 
                        : message;

    return trimmedMessage;
}

// Функция для удаления сообщений из Telegram-канала и обновления базы данных
async function removeOutdatedAdsFromChannel() {
    console.log('Начинается удаление устаревших объявлений');
    const adsToDelete = await DB.getOutdatedAds();

    for (const ad of adsToDelete) {
        try {
            const messageIds = ad.message_id;
            let successDeleted = false;
            for (const messageId of messageIds) {
                try {
                    const deleteResult = await bot.deleteMessage(ad.tg_channel, messageId);
                    if (deleteResult) successDeleted = true;
                } catch (err) {
                    console.error(`Ошибка при удалении из канала ${ad.tg_channel} сообщения ${messageId}:`, err);
                }
            }

            // После успешного удаления, обновляем базу данных
            if (successDeleted) {
                await DB.markAdAsInactive(ad.id);
                console.log(`Объявление с ID ${ad.id} удалено, статус объявления обновлен.`);

                // Удаляем изображения из S3 после обновления статуса
                const photoNames = ad.converted_photos;
                await deleteImagesFromS3(photoNames);
            }
        } catch (error) {
            console.error(`Ошибка при удалении сообщения ${ad.message_id}:`, error);
        }
    }
}

// Функция для удаления файла из S3
async function deleteImagesFromS3(photoNames) {
    const deleteParams = {
        Bucket: config.s3bucketName,
        Delete: {
            Objects: photoNames.map((name) => ({ Key: `images/${name}` })),
            Quiet: false, // Если true, то возвращает только ошибки при удалении, но не удалённые объекты
        }
    };

    try {
        const deleteResult = await s3.deleteObjects(deleteParams).promise();
        console.log('Изображения успешно удалены из S3:', deleteResult);
    } catch (error) {
        console.error('Ошибка при удалении изображений из S3:', error);
    }
}

// Функция для планирования задач отправки объявлений
function schedulePosts() {

    config.postTimes.forEach(time => {
        const [hour, minute] = time.split(':');
        console.log(`Запланирована отправка в ${hour}:${minute}`);

        // Планировщик отправки объявлений
        cron.schedule(`${minute} ${hour} * * *`, async () => {
            console.log(`Начинается отправка объявлений в ${time}`);
            await postAds();
        });
    });
}

// cron для удаления устаревших объявлений каждый день в 00:00
cron.schedule(config.cronSchedule, () => {
    console.log('Запуск удаления устаревших объявлений в 00:00');
    removeOutdatedAdsFromChannel();
});

schedulePosts();