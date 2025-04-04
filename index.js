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

    //console.log(logMessage);

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
                            parse_mode: 'HTML'
                        }));
                    } else if (config.photoType === 'converted') {
                        const photoNames = ad.converted_photos.slice(0, 10);
                        mediaGroup = photoNames.map((name, index) => ({
                            type: 'photo',
                            media: `${config.s3domain}/images/${name}`,
                            caption: index === 0 ? message : '',
                            parse_mode: 'HTML'
                        }));
                    } else {
                        const photoURLs = ad.converted_photos.slice(0, 10);
                        mediaGroup = photoURLs.map((url, index) => ({
                            type: 'photo',
                            media: url,
                            caption: index === 0 ? message : '',
                            parse_mode: 'HTML'
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

    const escapeMarkdown = (text) => text.replace(/([_*[\]()~`>#+\-=|{}!])/g, '\\$1');

    const messageParts = [
        `🏠 <b>Сдается</b> ${ad.house_type === 'apartment' ? `${ad.rooms}-комн. квартира` : ad.house_type === 'room' ? `Комната ${roomTypeText}${roomLocationText ? ` (${roomLocationText})` : ''}` : 'Дом'} ${ad.duration === 'long_time' ? 'на длительный срок' : 'посуточно'}${ad.area ? `, ${ad.area} м²` : ''}${ad.floor_current ? `, ${ad.floor_current}${ad.floor_total ? '/' + ad.floor_total : ''} этаж` : ''}${ad.bed_capacity ? `, 🛏 ${ad.bed_capacity} спальных мест` : ''}`,
        `📍 <b>Адрес:</b> г.${ad.city}, ${ad.district ? ad.district + ' р-н' : ''} ${ad.microdistrict ? ', ' + ad.microdistrict : ''} ${ad.address ? ', ' + ad.address : ''}`,
        `👤 <b>Сдает:</b> ${ad.author === 'Хозяин недвижимости' || ad.author === 'owner' ? 'собственник' : 'посредник'}`,
        `💰 <b>Цена:</b> ${ad.price.toLocaleString('ru-RU')} ₸`,
        `📞 <b>Контакты:</b> ${ad.phone} ${`<a href="https://api.whatsapp.com/send?phone=${ad.phone.replace(/[^0-9]/g, '').replace(/^8/, '7')}">WhatsApp</a>`}`,
        `🛋️ <b>Удобства:</b> ${[ad.toilet, ad.bathroom, ad.furniture, ad.facilities].filter(Boolean).join(', ') || ''}`,
        ad.rental_options ? `📜 <b>Правила заселения:</b> ${ad.rental_options}` : '',
        ad.condition ? `🧱 <b>Состояние:</b> ${ad.condition === 'дизайнерский' ? 'дизайнерский ремонт' : ad.condition}` : '',
        `📝 <b>Описание:</b> ${ad.description ? ad.description.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}`,
    ];

    const message = messageParts.filter(Boolean).join('\n');
    const trimmedMessage = message.length > 1024 
                        ? message.substring(0, message.lastIndexOf(' ', 1024)) + '...' 
                        : message;

    return trimmedMessage;
}

// Функция для деактивации устаревших объявлений
async function deactivateOutdatedAds() {
    console.log('Начинается деактивация устаревших объявлений');
    const adsToDeactivate = await DB.getOutdatedAds();

    for (const ad of adsToDeactivate) {
        try {
            await DB.markAdAsInactive(ad.id);
            console.log(`Объявление с ID ${ad.id} деактивировано.`);
        } catch (error) {
            console.error(`Ошибка при деактивации объявления ${ad.id}:`, error);
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

// Планировщик для деактивации устаревших объявлений каждый день в 00:00
cron.schedule(config.cronSchedule, () => {
    console.log('Запуск деактивации устаревших объявлений в 00:00');
    deactivateOutdatedAds();
});

schedulePosts();