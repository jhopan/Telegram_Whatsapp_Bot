// src/telegram/scenes/scheduleScene.js
const { Scenes, Markup } = require('telegraf');
const logger =require('../../utils/logger');
// Pastikan path ini benar jika Anda sudah memindahkan parseDateTime
const { parseDateTime } = require('../../utils/dateTimeParser'); 
const storageService = require('../../services/storageService');
const { isReady } = require('../../whatsapp/client');

const SCHEDULE_SCENE_ID = 'scheduleWizard'; // Ganti ID Scene agar konsisten

const scheduleScene = new Scenes.WizardScene(
    SCHEDULE_SCENE_ID,
    // Langkah 1: Minta nomor tujuan
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 1: Meminta Nomor Tujuan. User: ${ctx.from.id}, Username: ${ctx.from.username}`);
        try {
            ctx.scene.session.state = {}; 
            logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 1: ctx.scene.session.state diinisialisasi.`);

            await ctx.reply('Baik, mari kita jadwalkan pesan.\n\nSilakan masukkan nomor WhatsApp tujuan (contoh: 08123456789 atau 6281234567890).\n\nKirim /batalscene untuk keluar dari proses ini.');
            return ctx.wizard.next(); 
        } catch (e) {
            logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Error di Langkah 1:`, e);
            await ctx.reply('Terjadi kesalahan saat memulai penjadwalan, silakan coba lagi.');
            return ctx.scene.leave();
        }
    },
    // Langkah 2: Tangani input nomor tujuan, minta isi pesan
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 2: Menangani Nomor Tujuan. User: ${ctx.from.id}, Username: ${ctx.from.username}`);
        try {
            if (!ctx.scene.session.state) {
                logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 2: ctx.scene.session.state tidak ada! User: ${ctx.from.id}`);
                await ctx.reply('Terjadi kesalahan internal (state tidak ada). Silakan mulai ulang dengan /start.');
                return ctx.scene.leave();
            }

            // Handler ini sekarang seharusnya hanya menerima pesan teks
            if (!ctx.message || !ctx.message.text) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 2: Input bukan teks atau tidak ada pesan. User: ${ctx.from.id}`);
                await ctx.reply('Input tidak valid. Silakan masukkan nomor tujuan berupa teks. Kirim /batalscene untuk keluar.');
                return; // Tetap di langkah ini agar pengguna bisa mencoba lagi
            }

            const phoneNumber = ctx.message.text.trim();
            logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 2: Nomor diterima: "${phoneNumber}". User: ${ctx.from.id}`);

            const cleanedPhoneNumber = phoneNumber.replace(/[<>]/g, '').replace(/[\s-]/g, ''); 
            if (!/^\+?[0-9]{8,15}$/.test(cleanedPhoneNumber)) { 
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 2: Format nomor tidak valid: "${phoneNumber}" (cleaned: "${cleanedPhoneNumber}"). User: ${ctx.from.id}`);
                await ctx.reply('Format nomor telepon tidak valid. Coba lagi (misal: 08123456789 atau +6281234567890).\nKirim /batalscene untuk keluar.');
                return; 
            }

            ctx.scene.session.state.target = cleanedPhoneNumber; 
            await ctx.reply(`Nomor tujuan: ${cleanedPhoneNumber}\n\nSekarang masukkan isi pesan yang ingin Anda kirim.\n\nKirim /batalscene untuk keluar.`);
            return ctx.wizard.next(); 
        } catch (e) {
            logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Error di Langkah 2:`, e);
            await ctx.reply('Terjadi kesalahan saat memproses nomor tujuan, silakan coba lagi.');
            return ctx.scene.leave();
        }
    },
    // Langkah 3: Tangani input isi pesan, minta waktu dan tanggal
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 3: Menangani Isi Pesan. User: ${ctx.from.id}, Username: ${ctx.from.username}`);
        try {
            if (!ctx.scene.session.state) {
                logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 3: ctx.scene.session.state tidak ada! User: ${ctx.from.id}`);
                await ctx.reply('Terjadi kesalahan internal (state tidak ada). Silakan mulai ulang dengan /start.');
                return ctx.scene.leave();
            }
            if (!ctx.message || !ctx.message.text) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 3: Tidak ada input teks untuk pesan. User: ${ctx.from.id}`);
                await ctx.reply('Input tidak valid. Silakan masukkan isi pesan. Kirim /batalscene untuk keluar.');
                return;
            }
            const messageText = ctx.message.text.trim();
            logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 3: Pesan diterima: "${messageText}". User: ${ctx.from.id}`);

            if (!messageText || messageText.length === 0) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 3: Isi pesan kosong. User: ${ctx.from.id}`);
                await ctx.reply('Isi pesan tidak boleh kosong. Coba lagi.\nKirim /batalscene untuk keluar.');
                return; 
            }
            ctx.scene.session.state.text = messageText;
            await ctx.reply(`Isi pesan: "${messageText}"\n\nSekarang masukkan waktu dan tanggal penjadwalan.\nFormat: HH:MM DD/MM/YYYY (Contoh: 17:00 25/12/2025).\n\nKirim /batalscene untuk keluar.`);
            return ctx.wizard.next(); 
        } catch (e) {
            logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Error di Langkah 3:`, e);
            await ctx.reply('Terjadi kesalahan saat memproses isi pesan, silakan coba lagi.');
            return ctx.scene.leave();
        }
    },
    // Langkah 4: Tangani input tanggal/waktu, proses penjadwalan
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Menangani Tanggal/Waktu. User: ${ctx.from.id}, Username: ${ctx.from.username}`);
        try {
            if (!ctx.scene.session.state) {
                logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: ctx.scene.session.state tidak ada! User: ${ctx.from.id}`);
                await ctx.reply('Terjadi kesalahan internal (state tidak ada). Silakan mulai ulang dengan /start.');
                return ctx.scene.leave();
            }
            if (!ctx.message || !ctx.message.text) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Tidak ada input teks untuk tanggal/waktu. User: ${ctx.from.id}`);
                await ctx.reply('Input tidak valid. Silakan masukkan tanggal dan waktu. Kirim /batalscene untuk keluar.');
                return;
            }
            const dateTimeInput = ctx.message.text.trim();
            logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Tanggal/Waktu diterima: "${dateTimeInput}". User: ${ctx.from.id}`);

            const parts = dateTimeInput.split(' ');
            const timeStr = parts[0];
            const dateStr = parts[1];

            if (!timeStr || !dateStr || parts.length !== 2) { 
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Format input tanggal/waktu salah: "${dateTimeInput}". User: ${ctx.from.id}`);
                await ctx.reply('Format tanggal dan waktu salah. Pastikan ada spasi antara waktu dan tanggal (Contoh: 17:00 25/12/2025).\nKirim /batalscene untuk keluar.');
                return; 
            }

            const parsedDateTime = parseDateTime(timeStr, dateStr);

            if (!parsedDateTime) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Parsing tanggal/waktu gagal untuk "${timeStr} ${dateStr}". User: ${ctx.from.id}`);
                await ctx.reply(`Format tanggal atau waktu salah, atau tanggal tidak valid. Gunakan HH:MM untuk waktu dan DD/MM/YYYY untuk tanggal (Contoh: 17:00 25/12/2025).\nKirim /batalscene untuk keluar.`);
                return; 
            }

            const now = new Date();
            const oneMinuteLater = new Date(now.getTime() + 60000);

            if (parsedDateTime <= oneMinuteLater) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Waktu penjadwalan sudah lewat: "${parsedDateTime.toISOString()}". User: ${ctx.from.id}`);
                await ctx.reply('Tanggal dan waktu penjadwalan harus di masa depan (minimal lebih dari 1 menit dari sekarang). Coba lagi.\nKirim /batalscene untuk keluar.');
                return; 
            }

            if (!isReady()) {
                logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Langkah 4: Klien WhatsApp tidak siap saat akan menjadwalkan. User: ${ctx.from.id}`);
                await ctx.reply('⚠️ Klien WhatsApp saat ini tidak siap (mungkin terputus atau belum login). Penjadwalan dibatalkan. Silakan coba lagi setelah memastikan WhatsApp terhubung.');
                return ctx.scene.leave();
            }

            const { target, text } = ctx.scene.session.state;
            const schedule = {
                target,
                dateTime: parsedDateTime.toISOString(),
                text,
                userId: ctx.from.id, 
                sent: false,
            };

            const savedSchedule = storageService.addScheduledMessage(schedule);
            logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Pesan berhasil dijadwalkan oleh ${ctx.from.id} untuk ${target} ID: ${savedSchedule.id}`);
            
            const userFriendlyDateTime = parsedDateTime.toLocaleString('id-ID', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar'
            });
            await ctx.reply(`✅ Pesan untuk "${target}" berhasil dijadwalkan pada ${userFriendlyDateTime} (ID: ${savedSchedule.id})`);
        
        } catch (e) {
            logger.error(`[SCENE: ${SCHEDULE_SCENE_ID}] Error di Langkah 4:`, e);
            await ctx.reply('Terjadi kesalahan saat memproses tanggal/waktu, silakan coba lagi.');
            return ctx.scene.leave(); 
        }
        return ctx.scene.leave(); 
    }
);

// Menambahkan perintah /batalscene di dalam scene untuk keluar
scheduleScene.command('batalscene', async (ctx) => {
    logger.info(`[SCENE: ${SCHEDULE_SCENE_ID}] Perintah /batalscene diterima. User: ${ctx.from.id}, Username: ${ctx.from.username}`);
    await ctx.reply('Penjadwalan dibatalkan.');
    return ctx.scene.leave();
});

// --- PERUBAHAN DI SINI ---
// Komentari atau hapus handler .on('message') yang umum di level scene untuk sementara
// scheduleScene.on('message', async (ctx) => {
//     logger.warn(`[SCENE: ${SCHEDULE_SCENE_ID}] Menerima pesan tak terduga saat di tengah scene (tidak ditangani oleh langkah wizard saat ini): "${ctx.message.text}". User: ${ctx.from.id}, Username: ${ctx.from.username}. Current step: ${ctx.wizard.cursor}`);
//     await ctx.reply('Mohon ikuti instruksi atau kirim /batalscene untuk keluar dari proses penjadwalan saat ini.');
// });

module.exports = scheduleScene;
