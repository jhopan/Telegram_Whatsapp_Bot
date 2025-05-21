// src/config/index.js
require('dotenv').config(); // Memuat variabel dari .env ke process.env

module.exports = {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    waSessionFile: process.env.WA_SESSION_FILENAME || 'whatsapp-session.json',
    // Tambahkan konfigurasi lain jika perlu
};