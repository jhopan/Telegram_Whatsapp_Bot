// src/config/index.js
require('dotenv').config(); // Baris ini yang paling penting!

module.exports = {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    waSessionFile: process.env.WA_SESSION_FILENAME || 'whatsapp-session.json',
    ownerWhatsAppLink: process.env.OWNER_WHATSAPP_LINK || 'https://wa.me/6282298657242?text=Bantuan%20Bot', // Fallback jika tidak ada di .env
};