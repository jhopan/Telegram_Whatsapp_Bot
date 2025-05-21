// src/scheduler/tasks.js
const storageService = require('../services/storageService');
const { sendWhatsAppMessage, isReady } = require('../whatsapp/client');
const logger = require('../utils/logger');

async function checkAndSendScheduledMessages() {
    if (!isReady()) {
        logger.warn('[Scheduler] Klien WhatsApp belum siap, skip pemeriksaan pesan terjadwal.');
        return;
    }

    logger.info('[Scheduler] Memeriksa pesan terjadwal...');
    const dueMessages = storageService.getDueMessages();

    if (dueMessages.length === 0) {
        logger.info('[Scheduler] Tidak ada pesan yang perlu dikirim saat ini.');
        return;
    }

    for (const message of dueMessages) {
        try {
            logger.info(`[Scheduler] Mengirim pesan terjadwal ID: ${message.id} ke ${message.target}`);
            await sendWhatsAppMessage(message.target, message.text);
            storageService.markAsSent(message.id);
            logger.info(`[Scheduler] Pesan ID: ${message.id} berhasil dikirim dan ditandai.`);
        } catch (error) {
            logger.error(`[Scheduler] Gagal mengirim pesan terjadwal ID: ${message.id}. Error: ${error.message}`);
            // Anda bisa menambahkan logika retry atau notifikasi kegagalan di sini
        }
    }
}

module.exports = {
    checkAndSendScheduledMessages,
};