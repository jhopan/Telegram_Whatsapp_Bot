// src/telegram/handlers/cancelScheduledHandler.js
const storageService = require('../../services/storageService');
const logger = require('../../utils/logger');

module.exports = (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2 || !parts[1]) {
        return ctx.reply('Format salah. Gunakan: /batalkan <ID_pesan_terjadwal>');
    }
    const scheduleIdToCancel = parts[1];
    const schedules = storageService.getAllSchedules();
    const scheduleExists = schedules.find(s => s.id === scheduleIdToCancel && s.userId === ctx.from.id);

    if (!scheduleExists) {
       return ctx.reply(`Pesan terjadwal dengan ID "${scheduleIdToCancel}" tidak ditemukan atau bukan milik Anda.`);
    }

    if (storageService.cancelSchedule(scheduleIdToCancel)) {
        logger.info(`Pesan ${scheduleIdToCancel} dibatalkan oleh user ${ctx.from.id}`);
        ctx.reply(`Pesan terjadwal dengan ID "${scheduleIdToCancel}" berhasil dibatalkan.`);
    } else {
        ctx.reply(`Gagal membatalkan pesan terjadwal dengan ID "${scheduleIdToCancel}". Mungkin sudah terkirim atau ID salah.`);
    }
};