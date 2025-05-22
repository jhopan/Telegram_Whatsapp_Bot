// src/telegram/scenes/cancelScene.js
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const storageService = require('../../services/storageService');

const CANCEL_WIZARD_SCENE_ID = 'cancelWizard';

const cancelScene = new Scenes.WizardScene(
    CANCEL_WIZARD_SCENE_ID,
    // Langkah 0: Tampilkan jadwal dan minta ID
    async (ctx) => {
        logger.info(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Langkah 0: Meminta ID Pembatalan. User: ${ctx.from.id}`);
        try {
            const userId = ctx.from.id;
            const schedules = storageService.getAllSchedules().filter(s => s.userId === userId && !s.sent);

            if (schedules.length === 0) {
                await ctx.reply('Anda tidak memiliki pesan terjadwal yang aktif untuk dibatalkan.');
                return ctx.scene.leave();
            }

            let message = 'Berikut adalah daftar pesan terjadwal Anda yang aktif:\n\n';
            schedules.forEach(s => {
                const scheduledTime = new Date(s.dateTime);
                message += `ID: ${s.id}\n`;
                message += `Target: ${s.target}\n`;
                message += `Waktu: ${scheduledTime.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}\n`; // Sesuaikan timeZone jika perlu
                message += `Pesan: ${s.text.substring(0, 30)}${s.text.length > 30 ? '...' : ''}\n`;
                message += `-----------------------------\n`;
            });
            message += '\nSilakan masukkan ID pesan yang ingin Anda batalkan.\nKirim /batalscene untuk keluar dari proses ini.';
            
            // Kirim pesan dalam beberapa bagian jika terlalu panjang
            const MAX_MESSAGE_LENGTH = 4096;
            if (message.length > MAX_MESSAGE_LENGTH) {
                await ctx.reply('Daftar pesan terjadwal Anda terlalu panjang untuk ditampilkan sekaligus. Berikut adalah sebagian:');
                let currentPart = '';
                for (const schedule of schedules) {
                    const scheduleLine = `ID: ${schedule.id}, Target: ${schedule.target}, Waktu: ${new Date(schedule.dateTime).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}, Pesan: ${schedule.text.substring(0,20)}...\n`;
                    if (currentPart.length + scheduleLine.length > MAX_MESSAGE_LENGTH - 200) { // -200 untuk pesan permintaan ID
                        await ctx.reply(currentPart);
                        currentPart = '';
                    }
                    currentPart += scheduleLine;
                }
                if (currentPart) {
                    await ctx.reply(currentPart);
                }
                await ctx.reply('Silakan masukkan ID pesan yang ingin Anda batalkan dari daftar di atas.\nKirim /batalscene untuk keluar.');

            } else {
                await ctx.reply(message);
            }
            
            return ctx.wizard.next(); // Maju untuk menunggu input ID
        } catch (e) {
            logger.error(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Error di Langkah 0:`, e);
            await ctx.reply('Terjadi kesalahan saat menampilkan daftar jadwal.');
            return ctx.scene.leave();
        }
    },
    // Langkah 1: Terima ID dan proses pembatalan
    async (ctx) => {
        logger.info(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Langkah 1: Memproses ID Pembatalan. User: ${ctx.from.id}`);
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply('Input tidak valid. Silakan masukkan ID pesan yang ingin dibatalkan atau kirim /batalscene.');
                return; // Tetap di langkah ini
            }

            const scheduleIdToCancel = ctx.message.text.trim();
            const userId = ctx.from.id;
            const schedules = storageService.getAllSchedules(); // Ambil semua untuk verifikasi kepemilikan
            const scheduleExists = schedules.find(s => s.id === scheduleIdToCancel && s.userId === userId && !s.sent);

            if (!scheduleExists) {
                await ctx.reply(`Pesan terjadwal dengan ID "${scheduleIdToCancel}" tidak ditemukan, bukan milik Anda, atau sudah terkirim/dibatalkan.\nSilakan coba lagi atau kirim /batalscene.`);
                return; // Tetap di langkah ini
            }

            if (storageService.cancelSchedule(scheduleIdToCancel)) {
                logger.info(`Pesan ${scheduleIdToCancel} berhasil dibatalkan oleh user ${userId}`);
                await ctx.reply(`✅ Pesan terjadwal dengan ID "${scheduleIdToCancel}" berhasil dibatalkan.`);
            } else {
                // Ini seharusnya tidak terjadi jika scheduleExists benar, tapi sebagai fallback
                logger.warn(`Gagal membatalkan scheduleId ${scheduleIdToCancel} padahal ditemukan.`);
                await ctx.reply(`⚠️ Gagal membatalkan pesan terjadwal dengan ID "${scheduleIdToCancel}".`);
            }
            return ctx.scene.leave();
        } catch (e) {
            logger.error(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Error di Langkah 1:`, e);
            await ctx.reply('Terjadi kesalahan saat membatalkan jadwal.');
            return ctx.scene.leave();
        }
    }
);

cancelScene.command('batalscene', async (ctx) => {
    logger.info(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Perintah /batalscene diterima. User: ${ctx.from.id}`);
    await ctx.reply('Proses pembatalan jadwal dihentikan.');
    return ctx.scene.leave();
});

// Menangani pesan yang tidak diharapkan
cancelScene.on('message', async (ctx) => {
    logger.warn(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Menerima pesan tak terduga: "${ctx.message.text}". User: ${ctx.from.id}`);
    await ctx.reply('Mohon masukkan ID pesan yang valid atau kirim /batalscene untuk keluar.');
});

module.exports = cancelScene;
