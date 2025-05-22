// src/whatsapp/client.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const logger = require('../utils/logger');
const config = require('../config');
const path = require('path');
const fs = require('fs');

const waClient = new Client({
    authStrategy: new LocalAuth({ 
        dataPath: path.join(__dirname, '../../sessions'),
        clientId: config.waSessionFile ? config.waSessionFile.replace('.json', '') : undefined 
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        // timeout: 120000, // Opsional, jika inisialisasi sering timeout
    }
});

let qrCodeDataUrl = null;
let isWhatsAppReady = false;
let knownGroups = []; // Variabel untuk menyimpan daftar grup yang diikuti bot

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
    qrCodeDataUrl = null; 
});

waClient.on('auth_failure', async (msg) => { 
    logger.error('Autentikasi WhatsApp GAGAL:', msg);
    isWhatsAppReady = false;
    const clientId = config.waSessionFile ? config.waSessionFile.replace('.json', '') : undefined;
    const sessionDirName = `session${clientId ? `-${clientId}` : ''}`;
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

waClient.on('ready', async () => { 
    isWhatsAppReady = true;
    qrCodeDataUrl = null; 
    logger.info('Klien WhatsApp SIAP!');
    
    // Tambahkan penundaan kecil sebelum mengambil chat, untuk memberi waktu WhatsApp Web stabil
    setTimeout(async () => {
        try {
            logger.info('Mencoba mengambil daftar chat setelah penundaan...');
            const chats = await waClient.getChats();
            knownGroups = chats.filter(chat => chat.isGroup).map(group => ({
                name: group.name,
                id: group.id._serialized
            }));
            logger.info(`Ditemukan dan disimpan ${knownGroups.length} grup yang diikuti bot.`);
            // knownGroups.forEach(g => logger.info(` - Grup: ${g.name} (ID: ${g.id})`));
        } catch (e) {
            logger.error('Gagal mengambil daftar grup saat ready (setelah penundaan):', e);
            // Biarkan knownGroups tetap array kosong jika gagal
            knownGroups = []; 
        }
    }, 5000); // Penundaan 5 detik (5000 ms), bisa disesuaikan
});

waClient.on('disconnected', (reason) => {
    logger.warn('Klien WhatsApp terputus:', reason);
    isWhatsAppReady = false;
    knownGroups = []; // Kosongkan daftar grup jika terputus
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
        knownGroups = []; // Kosongkan daftar grup saat logout

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
            return { success: true, message: 'Berhasil logout (data sesi tidak ditemukan).' };
        }
    } catch (error) {
        logger.error('Error saat proses logout WhatsApp:', error);
        isWhatsAppReady = false;
        qrCodeDataUrl = null;
        knownGroups = [];
        return { success: false, message: `Error saat logout: ${error.message}` };
    }
}

/**
 * Mencari grup berdasarkan nama dari daftar grup yang diketahui.
 * @param {string} name Nama grup yang dicari.
 * @returns {Array<{name: string, id: string}>} Array grup yang cocok.
 */
function findGroupByName(name) {
    if (!name || typeof name !== 'string' || !isWhatsAppReady) {
        logger.warn(`findGroupByName dipanggil dengan nama tidak valid atau WA tidak siap. Nama: ${name}, WA Ready: ${isWhatsAppReady}`);
        return [];
    }
    const searchTerm = name.toLowerCase().trim();
    if (knownGroups.length === 0) {
        logger.warn('findGroupByName: Daftar knownGroups kosong. Mungkin getChats() gagal atau belum selesai.');
    }
    return knownGroups.filter(group => group.name && group.name.toLowerCase().includes(searchTerm));
}

async function joinGroupByInviteAndGetInfo(inviteCode) {
    // ... (fungsi joinGroupByInviteAndGetInfo tetap sama seperti versi terakhir Anda) ...
    if (!isWhatsAppReady) {
        return { success: false, message: 'Klien WhatsApp belum siap.' };
    }
    if (!inviteCode || typeof inviteCode !== 'string' || inviteCode.trim() === '') {
        return { success: false, message: 'Kode undangan tidak valid.' };
    }

    try {
        logger.info(`Mencoba bergabung dengan grup menggunakan kode: ${inviteCode}`);
        const groupId = await waClient.acceptInvite(inviteCode.trim());
        logger.info(`Berhasil bergabung dengan grup, ID Grup: ${groupId}`);

        const chat = await waClient.getChatById(groupId);
        if (chat && chat.isGroup) {
            logger.info(`Detail grup ditemukan: Nama="${chat.name}", ID=${chat.id._serialized}`);
            if (!knownGroups.find(g => g.id === chat.id._serialized)) {
                knownGroups.push({ name: chat.name, id: chat.id._serialized });
                logger.info(`Grup baru "${chat.name}" ditambahkan ke knownGroups.`);
            }
            return { 
                success: true, 
                groupId: chat.id._serialized, 
                groupName: chat.name, 
                message: `Berhasil bergabung dengan grup "${chat.name}".` 
            };
        } else {
            logger.warn(`Berhasil bergabung dengan grup ID ${groupId}, tetapi gagal mendapatkan detail chat atau bukan grup.`);
            return { 
                success: true, 
                groupId: groupId, 
                groupName: 'Nama Tidak Diketahui', 
                message: `Berhasil bergabung dengan grup (ID: ${groupId}), tetapi nama grup tidak dapat diambil.` 
            };
        }
    } catch (error) {
        logger.error(`Gagal bergabung dengan grup menggunakan kode ${inviteCode}:`, error);
        let userMessage = 'Gagal bergabung dengan grup.';
        let needsName = false;

        if (error.message) {
            if (error.message.includes('invite_code_expired') || error.message.includes('invalid')) {
                userMessage = 'Gagal bergabung: Link undangan sudah kedaluwarsa atau tidak valid.';
            } else if (error.message.includes('Group full')) {
                userMessage = 'Gagal bergabung: Grup sudah penuh.';
            } else if (error.message.includes('already in group') || (error.message.includes('failed to accept invite') && error.message.includes('contact is already a group participant'))) {
                userMessage = 'Bot sudah menjadi anggota grup ini. Jika Anda tahu nama grupnya, bot akan mencoba mencarinya.';
                needsName = true; 
                logger.warn(`Bot sudah ada di grup dengan kode ${inviteCode}. Membutuhkan nama grup untuk pencarian.`);
                return { success: false, message: userMessage, needsName: true, inviteCodeUsed: inviteCode };
            }
        }
        return { success: false, message: userMessage, needsName: needsName };
    }
}

module.exports = {
    initializeWhatsAppClient,
    logoutWhatsAppClient,
    joinGroupByInviteAndGetInfo,
    findGroupByName, 
    getKnownGroups: () => knownGroups, 
    getWhatsAppClient: () => waClient,
    isReady: () => isWhatsAppReady,
    getQrCodeDataUrl: () => qrCodeDataUrl,
    clearQrCodeDataUrl: () => { qrCodeDataUrl = null; },
    sendWhatsAppMessage: async (numberOrGroupId, message) => {
        // ... (fungsi sendWhatsAppMessage tetap sama) ...
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
                     if(cleanNumber.length < 9 || cleanNumber.length > 15) { 
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
