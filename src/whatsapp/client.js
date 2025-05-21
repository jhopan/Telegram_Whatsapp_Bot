// src/whatsapp/client.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); // Untuk generate QR sebagai data URI
const logger = require('../utils/logger');
const config = require('../config');
const path = require('path');
const fs = require('fs'); // Impor fs untuk operasi file sistem

// Inisialisasi klien WhatsApp
const waClient = new Client({
    authStrategy: new LocalAuth({ 
        dataPath: path.join(__dirname, '../../sessions'), // Folder untuk menyimpan sesi
        // Tentukan clientId berdasarkan waSessionFile dari config, hilangkan .json jika ada
        // Jika waSessionFile tidak ada di config, clientId akan undefined, dan LocalAuth akan default ke 'session'
        clientId: config.waSessionFile ? config.waSessionFile.replace('.json', '') : undefined 
    }),
    puppeteer: {
        headless: true, // Jalankan headless untuk server
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            // '--single-process', // opsional, bisa mengurangi penggunaan memori
            '--disable-gpu'
        ],
        // timeout: 120000, // Opsional: Tambahkan timeout yang lebih lama jika perlu (default 30 detik)
    }
});

let qrCodeDataUrl = null;
let isWhatsAppReady = false;

waClient.on('qr', async (qr) => {
    logger.info('QR Code diterima, silakan pindai.');
    try {
        qrCodeDataUrl = await qrcode.toDataURL(qr);
        logger.info('QR Code Data URL generated.');
    } catch (err) {
        logger.error('Gagal membuat QR code data URI:', err);
        qrCodeDataUrl = null;
    }
});

waClient.on('authenticated', () => {
    logger.info('WhatsApp terautentikasi!');
    qrCodeDataUrl = null; // Hapus QR setelah autentikasi
});

waClient.on('auth_failure', async (msg) => { 
    logger.error('Autentikasi WhatsApp GAGAL:', msg);
    isWhatsAppReady = false;
    // Tentukan nama direktori sesi yang benar berdasarkan clientId
    const clientId = config.waSessionFile ? config.waSessionFile.replace('.json', '') : undefined;
    const sessionDirName = `session${clientId ? `-${clientId}` : ''}`; // Jika clientId undefined, LocalAuth default ke 'session'
    const sessionDirPath = path.join(__dirname, '../../sessions', sessionDirName);
    try {
        if (fs.existsSync(sessionDirPath)) {
            logger.warn(`Menghapus direktori sesi yang gagal karena auth_failure: ${sessionDirPath}`);
            await fs.promises.rm(sessionDirPath, { recursive: true, force: true });
            logger.info('Direktori sesi berhasil dihapus. Silakan restart bot untuk scan QR baru.');
        }
    } catch (e) {
        logger.error('Gagal menghapus direktori sesi yang gagal:', e);
    }
});

waClient.on('ready', () => {
    isWhatsAppReady = true;
    qrCodeDataUrl = null; // Pastikan QR null saat ready
    logger.info('Klien WhatsApp SIAP!');
});

waClient.on('disconnected', (reason) => {
    logger.warn('Klien WhatsApp terputus:', reason);
    isWhatsAppReady = false;
    // Jika terputus karena logout, sesi sudah dihapus oleh fungsi logoutWhatsAppClient
});

function initializeWhatsAppClient() {
    logger.info('Menginisialisasi klien WhatsApp...');
    waClient.initialize().catch(err => {
        logger.error('Gagal menginisialisasi WhatsApp Client (dari logger.error):', err); 
        console.error("--- DETAIL ERROR LENGKAP INITIALIZE WHATSAPP CLIENT (dari console.error): ---");
        console.error(err); 
    });
}

async function logoutWhatsAppClient() {
    logger.info('Memulai proses logout WhatsApp...');
    if (!waClient) {
        logger.warn('Klien WhatsApp tidak diinisialisasi, tidak ada yang perlu di-logout.');
        return { success: false, message: 'Klien tidak diinisialisasi.' };
    }

    try {
        if (isWhatsAppReady) { 
            await waClient.logout(); 
            logger.info('Berhasil logout dari sesi WhatsApp (via waClient.logout()).');
        } else {
            logger.info('Klien WhatsApp tidak dalam kondisi ready, mungkin sudah terputus. Lanjut proses pembersihan.');
        }
        
        isWhatsAppReady = false;
        qrCodeDataUrl = null;

        const clientId = config.waSessionFile ? config.waSessionFile.replace('.json', '') : undefined;
        const sessionDirName = `session${clientId ? `-${clientId}` : ''}`;
        const sessionDirPath = path.join(__dirname, '../../sessions', sessionDirName);

        logger.info(`Mencoba menghapus direktori sesi: ${sessionDirPath}`);
        if (fs.existsSync(sessionDirPath)) {
            await fs.promises.rm(sessionDirPath, { recursive: true, force: true });
            logger.info(`Direktori sesi ${sessionDirPath} berhasil dihapus.`);
            return { success: true, message: 'Berhasil logout dan menghapus data sesi WhatsApp.' };
        } else {
            logger.warn(`Direktori sesi ${sessionDirPath} tidak ditemukan untuk dihapus.`);
            return { success: true, message: 'Berhasil logout (data sesi tidak ditemukan, mungkin sudah terhapus atau belum pernah dibuat).' };
        }
    } catch (error) {
        logger.error('Error saat proses logout WhatsApp:', error);
        isWhatsAppReady = false;
        qrCodeDataUrl = null;
        return { success: false, message: `Error saat logout: ${error.message}` };
    }
}


module.exports = {
    initializeWhatsAppClient,
    logoutWhatsAppClient,
    getWhatsAppClient: () => waClient,
    isReady: () => isWhatsAppReady,
    getQrCodeDataUrl: () => qrCodeDataUrl,
    clearQrCodeDataUrl: () => { qrCodeDataUrl = null; },
    sendWhatsAppMessage: async (numberOrGroupId, message) => {
        if (!isWhatsAppReady) {
            logger.warn('Klien WhatsApp belum siap untuk mengirim pesan.');
            throw new Error('WhatsApp client not ready.');
        }
        try {
            let chatId = numberOrGroupId;
            if (!numberOrGroupId.includes('@')) { 
                let cleanNumber = numberOrGroupId.replace(/\D/g, ''); 
                if (cleanNumber.startsWith('0')) {
                    cleanNumber = '62' + cleanNumber.substring(1); 
                } else if (!cleanNumber.startsWith('62')) {
                     // Asumsi jika tidak ada '0' di depan dan tidak ada '62', mungkin sudah format internasional tanpa '+'
                     // atau nomor pendek yang mungkin tidak valid. Validasi panjang bisa ditambahkan.
                     if(cleanNumber.length < 9 || cleanNumber.length > 15) { // Contoh validasi panjang sederhana
                        logger.warn(`Nomor ${numberOrGroupId} terlihat tidak valid setelah dibersihkan: ${cleanNumber}`);
                     }
                }

                logger.info(`Mencoba mendapatkan WID untuk nomor: ${cleanNumber}`);
                const numberDetails = await waClient.getNumberId(cleanNumber);
                if (numberDetails) {
                    chatId = numberDetails._serialized; 
                    logger.info(`WID berhasil didapatkan: ${chatId} untuk nomor ${cleanNumber}`);
                } else {
                    logger.warn(`Gagal mendapatkan WID untuk nomor ${cleanNumber}. Menggunakan format standar ${cleanNumber}@c.us`);
                    chatId = `${cleanNumber}@c.us`; 
                }
            } else {
                 logger.info(`Menggunakan ID grup yang sudah ada: ${numberOrGroupId}`);
            }
            
            logger.info(`Mengirim pesan ke chatId: ${chatId}`);
            const sentMessage = await waClient.sendMessage(chatId, message);
            logger.info(`Pesan terkirim ke ${chatId}. Message ID: ${sentMessage.id.id}`);
            return sentMessage;
        } catch (error) {
            logger.error(`Gagal mengirim pesan WhatsApp ke ${numberOrGroupId}: ${error.message}`);
            logger.error("Detail error pengiriman:", error); 
            throw error;
        }
    }
};
