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
let knownGroups = []; 
let knownContacts = []; // Variabel untuk menyimpan kontak yang diketahui

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    knownContacts = []; 
    knownGroups = [];   
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
    
    // Ambil daftar grup dengan mekanisme retry
    const maxRetriesGetChats = 3; 
    const retryDelayGetChats = 10000; 
    let attemptsGetChats = 0;
    let chatsFetched = false;
    await delay(2000); 

    while (attemptsGetChats < maxRetriesGetChats && !chatsFetched) {
        attemptsGetChats++;
        try {
            logger.info(`Mencoba mengambil daftar chat (Percobaan ${attemptsGetChats}/${maxRetriesGetChats})...`);
            const chats = await waClient.getChats();
            knownGroups = chats.filter(chat => chat.isGroup).map(group => ({
                name: group.name,
                id: group.id._serialized
            }));
            logger.info(`Ditemukan dan disimpan ${knownGroups.length} grup yang diikuti bot.`);
            chatsFetched = true; 
        } catch (e) {
            logger.error(`Gagal mengambil daftar grup (Percobaan ${attemptsGetChats}/${maxRetriesGetChats}):`, e);
            if (attemptsGetChats < maxRetriesGetChats) {
                logger.info(`Akan mencoba lagi getChats dalam ${retryDelayGetChats / 1000} detik...`);
                await delay(retryDelayGetChats);
            } else {
                logger.error(`Gagal mengambil daftar grup setelah ${maxRetriesGetChats} percobaan.`);
                knownGroups = []; 
            }
        }
    }

    // Ambil daftar kontak dengan mekanisme retry
    const maxRetriesGetContacts = 3;
    const retryDelayGetContacts = 7000; 
    let attemptsGetContacts = 0;
    let contactsFetched = false;
    await delay(3000); // Jeda awal sebelum getContacts

    while (attemptsGetContacts < maxRetriesGetContacts && !contactsFetched) {
        attemptsGetContacts++;
        try {
            logger.info(`Mencoba mengambil daftar kontak (Percobaan ${attemptsGetContacts}/${maxRetriesGetContacts})...`);
            const contacts = await waClient.getContacts();
            knownContacts = contacts
                .filter(contact => contact.isMyContact && contact.id && contact.id.user && (contact.name || contact.pushname)) 
                .map(contact => ({
                    name: contact.name || contact.pushname, 
                    id: contact.id._serialized, 
                    number: contact.id.user 
                }));
            logger.info(`Ditemukan dan disimpan ${knownContacts.length} kontak.`);
            // --- LOGGING TAMBAHAN UNTUK KONTAK (DIIKTIFKAN) ---
            if (knownContacts.length > 0) {
                logger.info('Beberapa contoh kontak yang diambil (maksimal 5):');
                for (let i = 0; i < Math.min(5, knownContacts.length); i++) {
                    logger.info(` - Nama: ${knownContacts[i].name}, Nomor: ${knownContacts[i].number}, ID: ${knownContacts[i].id}`);
                }
            }
            // --- AKHIR LOGGING TAMBAHAN ---
            contactsFetched = true;
        } catch (e) {
            logger.error(`Gagal mengambil daftar kontak (Percobaan ${attemptsGetContacts}/${maxRetriesGetContacts}):`, e);
             if (attemptsGetContacts < maxRetriesGetContacts) {
                logger.info(`Akan mencoba lagi getContacts dalam ${retryDelayGetContacts / 1000} detik...`);
                await delay(retryDelayGetContacts);
            } else {
                logger.error(`Gagal mengambil daftar kontak setelah ${maxRetriesGetContacts} percobaan.`);
                knownContacts = []; 
            }
        }
    }
});

waClient.on('disconnected', (reason) => { 
    logger.warn('Klien WhatsApp terputus:', reason);
    isWhatsAppReady = false;
    knownGroups = []; 
    knownContacts = []; 
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
    if (!waClient) { return { success: false, message: 'Klien tidak diinisialisasi.' }; }
    try {
        if (isWhatsAppReady) { await waClient.logout(); logger.info('Berhasil logout dari sesi WhatsApp (via waClient.logout()).'); }
        else { logger.info('Klien WhatsApp tidak dalam kondisi ready, lanjut pembersihan.'); }
        isWhatsAppReady = false; qrCodeDataUrl = null; knownGroups = []; knownContacts = []; 
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
        isWhatsAppReady = false; qrCodeDataUrl = null; knownGroups = []; knownContacts = [];
        return { success: false, message: `Error saat logout: ${error.message}` };
    }
}

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
    if (!isWhatsAppReady) { return { success: false, message: 'Klien WhatsApp belum siap.' }; }
    if (!inviteCode || typeof inviteCode !== 'string' || inviteCode.trim() === '') { return { success: false, message: 'Kode undangan tidak valid.' };}
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
            return { success: true, groupId: chat.id._serialized, groupName: chat.name, message: `Berhasil bergabung dengan grup "${chat.name}".` };
        } else {
            logger.warn(`Berhasil bergabung dengan grup ID ${groupId}, tetapi gagal mendapatkan detail chat atau bukan grup.`);
            return { success: true, groupId: groupId, groupName: 'Nama Tidak Diketahui', message: `Berhasil bergabung dengan grup (ID: ${groupId}), nama tidak dapat diambil.` };
        }
    } catch (error) { 
        logger.error(`Gagal bergabung dengan grup menggunakan kode ${inviteCode}:`, error);
        let userMessage = 'Gagal bergabung dengan grup.'; let needsName = false;
        if (error.message) {
            if (error.message.includes('invite_code_expired') || error.message.includes('invalid')) { userMessage = 'Gagal bergabung: Link undangan kedaluwarsa/tidak valid.'; }
            else if (error.message.includes('Group full')) { userMessage = 'Gagal bergabung: Grup sudah penuh.'; }
            else if (error.message.includes('already in group') || (error.message.includes('failed to accept invite') && error.message.includes('contact is already a group participant'))) {
                userMessage = 'Bot sudah menjadi anggota grup ini. Jika Anda tahu nama grupnya, bot akan mencoba mencarinya.';
                needsName = true; 
                logger.warn(`Bot sudah ada di grup dengan kode ${inviteCode}. Membutuhkan nama grup.`);
                return { success: false, message: userMessage, needsName: true, inviteCodeUsed: inviteCode };
            }
        }
        return { success: false, message: userMessage, needsName: needsName };
    }
}

/**
 * Mencari kontak berdasarkan nama dari daftar kontak yang diketahui (knownContacts).
 * @param {string} name Nama kontak yang dicari (bisa sebagian).
 * @returns {Array<{name: string, id: string, number: string}>} Array kontak yang cocok.
 */
function findContactsByName(name) {
    if (!isWhatsAppReady) {
        logger.warn('findContactsByName: Klien WhatsApp belum siap. Daftar kontak mungkin belum tersedia.');
        return [];
    }
    if (!name || typeof name !== 'string') {
        logger.warn(`findContactsByName: Nama input tidak valid: ${name}`);
        return [];
    }
    const searchTerm = name.toLowerCase().trim();
    logger.info(`[findContactsByName] Mencari dengan searchTerm: "${searchTerm}" di ${knownContacts.length} kontak.`); 
    if (knownContacts.length === 0) {
        logger.warn('findContactsByName: Daftar knownContacts kosong. Mungkin getContacts() gagal atau belum selesai dimuat.');
    }
    const results = knownContacts.filter(contact => 
        contact.name && contact.name.toLowerCase().includes(searchTerm)
    );
    logger.info(`[findContactsByName] Ditemukan ${results.length} kontak untuk searchTerm "${searchTerm}"`); 
    return results;
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
    },
    findContactsByName, 
    getKnownContacts: () => knownContacts 
};