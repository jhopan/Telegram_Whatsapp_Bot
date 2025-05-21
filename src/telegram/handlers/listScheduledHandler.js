// src/telegram/handlers/listScheduledHandler.js
const storageService = require('../../services/storageService');

module.exports = (ctx) => {
    const schedules = storageService.getAllSchedules().filter(s => s.userId === ctx.from.id); // Hanya tampilkan milik user

    if (schedules.length === 0) {
        return ctx.reply('Tidak ada pesan terjadwal yang belum terkirim.');
    }

    let message = 'Daftar Pesan Terjadwal Anda:\n\n';
    schedules.forEach(s => {
        const scheduledTime = new Date(s.dateTime);
        message += `ID: ${s.id}\n`;
        message += `Target: ${s.target}\n`;
        message += `Waktu: ${scheduledTime.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}\n`;
        message += `Pesan: <span class="math-inline">\{s\.text\.substring\(0, 50\)\}</span>{s.text.length > 50 ? '...' : ''}\n`;
        message += `-----------------------------\n`;
    });
    ctx.reply(message);
};