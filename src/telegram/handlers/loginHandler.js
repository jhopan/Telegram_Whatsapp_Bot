// src/telegram/handlers/loginHandler.js
const { getQrCodeDataUrl, isReady, clearQrCodeDataUrl } = require('../../whatsapp/client');
const logger = require('../../utils/logger');

module.exports = async (ctx) => {
    if (isReady()) {
        // Jika sudah login, kirim pesan dan jangan lanjutkan proses QR
        return ctx.reply('Anda sudah login ke WhatsApp. Tidak perlu scan QR lagi.');
    }

    // Beri tahu pengguna bahwa proses sedang berjalan
    ctx.reply('Sedang memproses permintaan login WhatsApp, mohon tunggu QR code...').catch(e => logger.error('Gagal mengirim pesan tunggu QR', e));

    let attempts = 0;
    const maxAttempts = 30; // Naikkan sedikit batas percobaan, misal 30 detik
    let qrSent = false; // Flag untuk memastikan QR hanya dikirim sekali

    const intervalId = setInterval(async () => {
        if (qrSent) { // Jika QR sudah pernah dikirim, hentikan interval ini
            clearInterval(intervalId);
            return;
        }
        
        attempts++;
        const qrDataUrl = getQrCodeDataUrl();

        if (qrDataUrl) {
            clearInterval(intervalId); // Hentikan interval setelah QR didapat
            qrSent = true; // Tandai bahwa kita akan mencoba mengirim QR
            logger.info(`Mencoba mengirim QR Code ke user: ${ctx.from.username || ctx.from.id}`);
            try {
                // --- PERBAIKAN UNTUK MENGIRIM DATA URI SEBAGAI BUFFER ---
                // Pisahkan metadata dari data base64
                const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, "");
                // Konversi base64 menjadi Buffer
                const imageBuffer = Buffer.from(base64Data, 'base64');

                // Mengirim QR sebagai gambar menggunakan Buffer
                await ctx.replyWithPhoto({ source: imageBuffer }, { caption: 'Pindai QR code ini dengan WhatsApp di ponsel Anda untuk login. QR akan hilang setelah dipindai atau setelah beberapa saat.' });
                // --- AKHIR PERBAIKAN ---
                logger.info(`QR Code berhasil dikirim ke user: ${ctx.from.username || ctx.from.id}`);
                // Pertimbangkan untuk tidak langsung clear QR di sini, biarkan whatsapp/client.js yang clear saat authenticated atau ready
                // clearQrCodeDataUrl(); 
            } catch (error) {
                logger.error('Gagal mengirim QR code ke Telegram (dari logger.error):');
                logger.error(error); // Log objek errornya jika logger mendukungnya
                console.error("--- DETAIL ERROR LENGKAP KIRIM QR KE TELEGRAM (dari console.error): ---");
                console.error(error); // Tampilkan objek error secara lebih detail di konsol standar
                ctx.reply('Gagal mengirim QR code ke Telegram. Coba lagi nanti. Periksa log server untuk detail.').catch(e => logger.error('Gagal mengirim pesan error kegagalan QR ke user', e));
            }
            return; // Keluar dari fungsi callback interval
        }

        if (isReady()) { // Jika selama menunggu, ternyata sudah ready (misal dari sesi sebelumnya yang baru aktif)
            clearInterval(intervalId);
            if (!qrSent) { // Hanya kirim pesan jika belum ada upaya kirim QR
                 ctx.reply('Login WhatsApp berhasil (sesi sebelumnya aktif atau baru saja terhubung).').catch(e => logger.error('Gagal mengirim pesan sesi aktif', e));
            }
            return;
        }

        if (attempts >= maxAttempts) {
            clearInterval(intervalId);
            if (!qrSent) { // Hanya kirim pesan jika belum ada upaya kirim QR
                logger.warn('Gagal mendapatkan QR code setelah beberapa percobaan.');
                ctx.reply('Gagal mendapatkan QR code saat ini. Pastikan bot berjalan dengan benar dan coba lagi perintah /login_wa setelah beberapa saat.').catch(e => logger.error('Gagal mengirim pesan gagal dapat QR', e));
            }
        }
    }, 1000); // Cek setiap 1 detik
};
