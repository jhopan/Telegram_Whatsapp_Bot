// src/telegram/scenes/cancelScene.js
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const storageService = require('../../services/storageService');

const CANCEL_WIZARD_SCENE_ID = 'cancelWizard';

const cancelScene = new Scenes.WizardScene(
    CANCEL_WIZARD_SCENE_ID,
    // Langkah 0: Tampilkan jadwal dengan nomor urut dan minta nomor urut
    async (ctx) => {
        logger.info(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Langkah 0: Meminta Pilihan Pembatalan. User: ${ctx.from.id}`);
        try {
            const userId = String(ctx.from.id);
            const activeSchedules = storageService.getAllSchedules().filter(s => String(s.userId) === userId && !s.sent);

            if (activeSchedules.length === 0) {
                await ctx.reply('Anda tidak memiliki pesan terjadwal yang aktif untuk dibatalkan.');
                return ctx.scene.leave();
            }

            let messageText = 'Berikut adalah daftar pesan terjadwal Anda yang aktif:\n\n';
            // Simpan jadwal yang ditampilkan untuk referensi di langkah berikutnya
            ctx.scene.session.state.displayedSchedules = activeSchedules;

            activeSchedules.forEach((s, index) => {
                const scheduledTime = new Date(s.dateTime);
                messageText += `${index + 1}. Target: ${s.targetDisplayName || s.target}\n`;
                messageText += `   Waktu: ${scheduledTime.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}\n`;
                messageText += `   Pesan: ${s.text ? s.text.substring(0, 30) : (s.mediaInfo ? `Media (${s.mediaInfo.filename || 'file'})` : 'Tidak ada teks')}${s.text && s.text.length > 30 ? '...' : ''}\n`;
                messageText += `   (ID Asli: ${s.id})\n`; // Tampilkan ID asli untuk referensi jika perlu
                messageText += `-----------------------------\n`;
            });
            messageText += '\nSilakan masukkan nomor urut pesan yang ingin Anda batalkan (misalnya: 1).\nKirim /batalscene untuk keluar dari proses ini.';
            
            // Tidak perlu logika pesan terpecah yang kompleks untuk daftar bernomor,
            // pengguna bisa scroll jika daftarnya panjang. Atau bisa diimplementasikan pagination nanti.
            await ctx.reply(messageText);
            
            return ctx.wizard.next(); // Maju untuk menunggu input nomor urut
        } catch (e) {
            logger.error(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Error di Langkah 0:`, e);
            await ctx.reply('Terjadi kesalahan saat menampilkan daftar jadwal.');
            return ctx.scene.leave();
        }
    },
    // Langkah 1: Terima nomor urut dan proses pembatalan
    async (ctx) => {
        logger.info(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Langkah 1: Memproses Pilihan Pembatalan. User: ${ctx.from.id}`);
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply('Input tidak valid. Silakan masukkan nomor urut pesan yang ingin dibatalkan atau kirim /batalscene.');
                return; // Tetap di langkah ini
            }

            const displayedSchedules = ctx.scene.session.state.displayedSchedules;
            if (!displayedSchedules || displayedSchedules.length === 0) {
                logger.warn(`[SCENE] Langkah 1: displayedSchedules tidak ada di session state. User: ${ctx.from.id}`);
                await ctx.reply('Terjadi kesalahan sesi. Silakan coba lagi dari awal.');
                return ctx.scene.leave();
            }

            const choiceNumber = parseInt(ctx.message.text.trim(), 10);

            if (isNaN(choiceNumber) || choiceNumber < 1 || choiceNumber > displayedSchedules.length) {
                await ctx.reply(`Pilihan tidak valid. Masukkan nomor urut antara 1 dan ${displayedSchedules.length}, atau kirim /batalscene.`);
                return; // Tetap di langkah ini
            }

            const scheduleToCancel = displayedSchedules[choiceNumber - 1]; // Ambil jadwal berdasarkan nomor urut (index array = nomor urut - 1)
            const scheduleIdToCancel = scheduleToCancel.id;
            const userId = String(ctx.from.id); 

            // Verifikasi ulang kepemilikan dan status (meskipun seharusnya sudah difilter)
            if (String(scheduleToCancel.userId) !== userId || scheduleToCancel.sent) {
                 await ctx.reply(`Pesan dengan ID "${scheduleIdToCancel}" tidak valid untuk dibatalkan saat ini.`);
                 return ctx.scene.leave();
            }


            if (storageService.cancelSchedule(scheduleIdToCancel)) {
                logger.info(`Pesan ${scheduleIdToCancel} (pilihan nomor ${choiceNumber}) berhasil dibatalkan oleh user ${userId}`);
                await ctx.reply(`✅ Pesan terjadwal nomor ${choiceNumber} (ID: "${scheduleIdToCancel}") berhasil dibatalkan.`);
            } else {
                logger.warn(`Gagal membatalkan scheduleId ${scheduleIdToCancel} padahal dipilih.`);
                await ctx.reply(`⚠️ Gagal membatalkan pesan terjadwal nomor ${choiceNumber} (ID: "${scheduleIdToCancel}"). Mungkin sudah tidak ada.`);
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

// Komentari atau hapus handler .on('message') yang umum jika tidak diperlukan lagi
// cancelScene.on('message', async (ctx) => {
//     logger.warn(`[SCENE: ${CANCEL_WIZARD_SCENE_ID}] Menerima pesan tak terduga: "${ctx.message.text}". User: ${ctx.from.id}`);
//     await ctx.reply('Mohon masukkan nomor urut pesan yang valid atau kirim /batalscene untuk keluar.');
// });

module.exports = cancelScene;
