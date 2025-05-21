// src/telegram/handlers/logoutHandler.js
const { logoutWhatsAppClient, isReady } = require('../../whatsapp/client');
const logger = require('../../utils/logger');

module.exports = async (ctx) => {
    try {
        if (!isReady()) {
            // Cek apakah sesi memang tidak ada atau hanya belum siap
            // Untuk logout, kita tetap coba hapus sesi jika ada
            logger.info(`Perintah /logout_wa diterima, klien WhatsApp saat ini tidak ready. Tetap mencoba proses logout dan hapus sesi.`);
            // Tidak perlu return di sini, biarkan proses logout berjalan
        }
        
        ctx.reply('Sedang memproses permintaan logout WhatsApp...').catch(e => logger.error('Gagal mengirim pesan tunggu logout', e));

        const result = await logoutWhatsAppClient();

        if (result.success) {
            logger.info(`Logout berhasil untuk user: ${ctx.from.username || ctx.from.id}. Pesan: ${result.message}`);
            ctx.reply(`✅ ${result.message}\nAnda sekarang bisa menggunakan /login_wa untuk masuk kembali.`);
        } else {
            logger.warn(`Logout gagal untuk user: ${ctx.from.username || ctx.from.id}. Pesan: ${result.message}`);
            ctx.reply(`⚠️ Gagal melakukan logout. ${result.message}\nSilakan periksa log server untuk detail.`);
        }
    } catch (error) {
        logger.error('Error tidak tertangani di logoutHandler:', error);
        ctx.reply('Maaf, terjadi kesalahan internal saat mencoba logout. Silakan periksa log server.').catch(e => logger.error('Gagal mengirim pesan error dari logoutHandler ke user', e));
    }
};
