// src/bot.js
const telegramBot = require('./telegram'); // Ini akan mengimpor instance bot Telegraf
const { initializeWhatsAppClient } = require('./whatsapp/client');
const { startScheduler } = require('./scheduler');
const logger = require('./utils/logger');

logger.info('Memulai Bot Asisten WhatsApp...');

// Inisialisasi Klien WhatsApp
initializeWhatsAppClient();

// Mulai Penjadwal
startScheduler();

// Mulai Bot Telegram
telegramBot.launch()
    .then(() => {
        logger.info('Bot Telegram berhasil dijalankan.');
    })
    .catch(err => {
        logger.error('Gagal menjalankan Bot Telegram:', err);
        process.exit(1); // Keluar jika bot Telegram gagal start
    });

// Penanganan graceful shutdown
process.once('SIGINT', () => {
    logger.info('Menerima SIGINT. Mematikan bot...');
    telegramBot.stop('SIGINT');
    // Anda mungkin juga ingin mematikan klien WhatsApp dengan benar jika ada metodenya
    // waClient.destroy(); // Jika menggunakan whatsapp-web.js
    process.exit(0);
});
process.once('SIGTERM', () => {
    logger.info('Menerima SIGTERM. Mematikan bot...');
    telegramBot.stop('SIGTERM');
    process.exit(0);
});