require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const DB = require('./db');
const cron = require('node-cron');
const moment = require('moment');

const bot = new TelegramBot(config.telegramBotToken, { polling: true });


function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Функция для отправки объявлений
async function postAds() {
    const adsByCity = await DB.getAds();
    
    for (const [city, ads] of Object.entries(adsByCity)) {
        const channelId = config.cityChannels[city];
        if (!channelId || ads.length === 0) continue;

        const maxPosts = Math.min(config.maxPostsPerUpdate, ads.length);
         for (let i = 0; i < maxPosts; i++) {
            setTimeout(async () => {
                const ad = ads[i];
                try {
                    const message = `
        🏠 *Сдается* ${data.house_type === 'apartment' ? data.rooms + '-комн.квартира' : data.house_type === 'room' ? 'комната' + roomTypeText + (roomLocationText ? ' ' + roomLocationText : '') : 'дом'} ${data.duration === 'long_time' ? 'на длительный срок' : 'посуточно'}, ${data.area} м², ${data.floor_current}/${data.floor_total} этаж${data.bed_capacity ? ', спальных мест - ' + data.bed_capacity : ''}
        *Адрес:* г.${data.city}, ${data.district} р-н, ${data.microdistrict ? data.microdistrict + ', ' : ''} ${data.address}
        *Сдает:* ${data.author === 'owner' ? 'собственник': 'посредник'}
        *Цена:* ${data.price} ₸
        *Депозит:* ${data.deposit ? `${data.deposit_value}%` : 'нет'}
        *Телефон:* ${data.phone} ${[ data.whatsapp ? `[WhatsApp](https://api.whatsapp.com/send?phone=${data.phone})` : '', data.tg_username ? `[Telegram](https://t.me/${data.tg_username})` : ''].filter(Boolean).join(' ')}
        🛋️ *Удобства*: ${[
            data.fridge ? 'холодильник' : '',
            data.washing_machine ? 'стиральная машина' : '',
            data.microwave ? 'микроволновая печь' : '',
            data.dishwasher ? 'посудомоечная машина' : '',
            data.iron ? 'утюг' : '',
            data.tv ? 'телевизор' : '',
            data.wifi ? 'Wi-Fi' : '',
            data.stove ? 'плита' : '',
            data.shower ? 'душ' : '',
            data.separate_toilet ? 'раздельный санузел' : '',
            data.bed_linen ? 'постельное белье' : '',
            data.towels ? 'полотенца' : '',
            data.hygiene_items ? 'средства гигиены' : '',
            data.kitchen ? 'кухня' : '',
            data.wardrobe ? 'хранение одежды' : '',
            data.sleeping_places ? 'спальные места' : ''
        ].filter(Boolean).join(', ')}
        📜 *Правила заселения*: ${[
            data.family ? 'для семьи' : '',
            data.single ? 'для одного' : '',
            data.with_child ? 'можно с детьми' : '',
            data.with_pets ? 'можно с животными' : '',
            data.max_guests ? `макс. гостей: ${data.max_guests}` : ''
        ].filter(Boolean).join(', ')}
        📝 *Описание*
        ${data.description}
        `;
        
                    const trimmedMessage = message.length > 1024 
                        ? message.substring(0, message.lastIndexOf(' ', 1024)) + '...' 
                        : message;
        
                    // Ограничиваем количество фотографий до 10
                    /*const photoURLs = ad.photos.slice(0, 10);
                    const mediaGroup = photoURLs.map((url, index) => ({
                        type: 'photo',
                        media: url,
                        caption: index === 0 ? trimmedMessage : '',
                        parse_mode: 'Markdown'
                    }));*/
        
                    const photoNames = ad.converted_photos.slice(0, 10);
                    const mediaGroup = photoNames.map((name, index) => ({
                        type: 'photo',
                        media: `${config.s3domain}/images/${name}`,
                        caption: index === 0 ? trimmedMessage : '',
                        parse_mode: 'Markdown'
                    }));
        
                    // Отправляем альбом с максимум 10 фотографиями
                    const messageGroup = await bot.sendMediaGroup(config.channelId, mediaGroup);
        
                    // Сохраняем message_id в базе данных
                    const messageIds = messageGroup.map(message => message.message_id);
                    await DB.markAdAsPosted(ad.ad_id, messageIds);
        
                    // Добавляем паузу между отправками (например, 1-2 секунды)
                    await delay(2000);
                } catch (error) {
                    if (error.response && error.response.statusCode === 429) {
                        const retryAfter = error.response.parameters?.retry_after || 30;
                        console.log(`Превышено количество запросов. Ожидаем ${retryAfter} секунд...`);
                        await delay(retryAfter * 1000); // Ждем, сколько предложит Telegram
                    } else {
                        console.error('Ошибка при отправке объявления:', error);
                    }
                }
         }, i * config.postIntervalMinutes * 60 * 1000);
        }
    }
}

// Функция для удаления сообщений из Telegram-канала и обновления базы данных
async function removeOutdatedAdsFromChannel() {
    const adsToDelete = await DB.getOutdatedAds();

    for (const ad of adsToDelete) {
        try {
            const messageIds = ad.message_id;
            let successDeleted = false;
            for (const messageId of messageIds) {
                try {
                    const deleteResult = await bot.deleteMessage(config.channelId, messageId);
                    if (deleteResult) successDeleted = true;
                } catch (err) {
                    console.error(`Ошибка при удалении из канала ${config.channelId} сообщения ${messageId}:`, err);
                }
            }

            // После успешного удаления, обновляем базу данных
            if (successDeleted) {
                await DB.markAdAsInactive(ad.id);
                console.log(`Объявление с ID ${ad.id} удалено, статус объявления обновлен.`);
            }
        } catch (error) {
            console.error(`Ошибка при удалении сообщения ${ad.message_id}:`, error);
        }
    }
}

// Функция для планирования задач
function schedulePosts() {
    config.postTimes.forEach(time => {
        const [hour, minute] = time.split(':');

        // Планировщик отправки объявлений
        cron.schedule(`${minute} ${hour} * * *`, async () => {
            console.log(`Начинается отправка объявлений в ${time}`);
            await postAdsForCitiesWithInterval();
        });
    });

    // Планировщик удаления устаревших объявлений каждую ночь в 2:00
    cron.schedule('0 2 * * *', async () => {
        console.log('Начинается удаление устаревших объявлений в 2:00');
        await removeOutdatedAdsFromChannel();
    });
}

schedulePosts();