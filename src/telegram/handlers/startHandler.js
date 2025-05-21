// src/telegram/handlers/startHandler.js
const logger = require('../../utils/logger'); // Tambahkan ini jika Anda ingin log saat bantuan ditampilkan

const helpMessage = `Selamat datang di Bot Asisten WhatsApp!

Perintah yang tersedia:
/login_wa - Mulai proses login ke WhatsApp Web.
/logout_wa - Logout dari sesi WhatsApp dan hapus data sesi.
/jadwalkanpesan <nomor_WA_atau_ID_grup> <HH:MM> <DD/MM/YYYY> <isi_pesan>
    Contoh: /jadwalkanpesan 081234567890 17:00 25/12/2025 Selamat Natal!
    Contoh Grup: /jadwalkanpesan xxxxxxxxxxxx@g.us 09:00 01/01/2026 Meeting tim
/daftarterjadwal - Lihat semua pesan yang telah dijadwalkan dan belum terkirim.
/batalkan <ID_pesan_terjadwal> - Batalkan pesan yang sudah dijadwalkan.
/bantuan - Tampilkan pesan bantuan ini.

PENTING:
- Bot ini menggunakan WhatsApp Web secara tidak resmi. Risiko pemblokiran akun WhatsApp Anda ada. Gunakan dengan bijak.
- Pastikan format tanggal dan waktu benar.
`;

module.exports = (ctx) => {
    // Anda bisa menambahkan log di sini jika ingin tahu kapan pesan bantuan diakses
    // logger.info(`Menampilkan pesan bantuan untuk user: ${ctx.from.username || ctx.from.id}`);
    ctx.reply(helpMessage).catch(err => {
        logger.error('Gagal mengirim pesan bantuan:', err);
    });
};
