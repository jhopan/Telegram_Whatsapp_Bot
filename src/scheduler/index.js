// src/scheduler/index.js
const cron = require('node-cron');
const { checkAndSendScheduledMessages } = require('./tasks');
const logger = require('../utils/logger');

function startScheduler() {
    // Jalankan setiap menit
    cron.schedule('* * * * *', () => {
        logger.info('Cron job berjalan untuk memeriksa pesan terjadwal.');
        checkAndSendScheduledMessages();
    });
    logger.info('Penjadwal (cron job) telah dimulai, berjalan setiap menit.');
}

module.exports = {
    startScheduler,
};