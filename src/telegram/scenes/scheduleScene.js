// src/telegram/scenes/scheduleScene.js
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const { parseDateTime } = require('../../utils/dateTimeParser'); 
const storageService = require('../../services/storageService');
const { 
    isReady, 
    joinGroupByInviteAndGetInfo, 
    findGroupByName, 
    getWhatsAppClient,
    findContactsByName // Pastikan ini diimpor
} = require('../../whatsapp/client'); 

const SCHEDULE_WIZARD_SCENE_ID = 'scheduleWizard'; 

const isValidWhatsAppNumber = (number) => { 
    const cleaned = String(number).replace(/[\s-()+]/g, '');
    return /^(628[0-9]{8,13}|08[0-9]{8,13})$/.test(cleaned);
};
const isValidWhatsAppGroupId = (id) => typeof id === 'string' && /^[0-9@._-]+@g\.us$/.test(id.trim());

function extractInviteCode(link) { 
    if (typeof link !== 'string') return null;
    const match = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]{18,24})/);
    return match ? match[1] : null;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Definisikan indeks langkah untuk kejelasan
const STEP_ASK_INITIAL_TARGET = 0;
const STEP_PROCESS_INITIAL_TARGET = 1;
const STEP_HANDLE_CHOICES_CONFIRMATION = 2; // Untuk pilihan kontak atau konfirmasi kontak tunggal, atau input nama grup
const STEP_ASK_MESSAGE_CONTENT = 3;
const STEP_PROCESS_DATETIME = 4;


const scheduleScene = new Scenes.WizardScene(
    SCHEDULE_WIZARD_SCENE_ID,
    // Langkah 0: Minta target awal
    async (ctx) => {
        const targetType = ctx.session.scheduleTargetType; 
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah ${ctx.wizard.cursor} (Minta Target Awal). User: ${ctx.from.id}, TargetType: ${targetType}`);
        try {
            ctx.scene.session.state = { targetType }; 
            let promptMessage = 'Baik, mari kita jadwalkan pesan.\n\n';
            if (targetType === 'personal') {
                promptMessage += 'Silakan masukkan nomor WhatsApp tujuan atau sebagian nama kontak yang tersimpan di WhatsApp Anda.';
            } else if (targetType === 'group') {
                promptMessage += 'Silakan masukkan link undangan grup WhatsApp, ID Grup (jika diketahui), atau nama grup (jika bot sudah menjadi anggota).';
            } else { 
                logger.error(`[SCENE] Langkah ${ctx.wizard.cursor}: targetType tidak diketahui: "${targetType}".`);
                await ctx.reply('Tipe target tidak diketahui. Proses dibatalkan.');
                return ctx.scene.leave();
            }
            promptMessage += '\n\nKirim /batalscene untuk keluar.';
            await ctx.reply(promptMessage);
            return ctx.wizard.next(); 
        } catch (e) { logger.error(`[SCENE] Error di Langkah ${ctx.wizard.cursor}:`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 1: Proses input target awal
    async (ctx) => {
        const { targetType } = ctx.scene.session.state;
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah ${ctx.wizard.cursor} (Proses Target Awal). User: ${ctx.from.id}, TargetType: ${targetType}`);
        try {
            if (!ctx.scene.session.state) { await ctx.reply('State error, coba lagi.'); return ctx.scene.leave(); }
            if (!ctx.message || !ctx.message.text) { 
                await ctx.reply('Input tidak valid. Mohon masukkan target yang diminta atau /batalscene.'); 
                return; 
            } 

            const targetInput = ctx.message.text.trim();
            logger.info(`[SCENE] Langkah ${ctx.wizard.cursor}: Target input: "${targetInput}"`);

            let finalTargetId = null;
            let targetDisplayName = targetInput;

            if (targetType === 'personal') {
                const cleanedPhoneNumber = targetInput.replace(/[<>]/g, '').replace(/[\s-()]/g, ''); 
                if (isValidWhatsAppNumber(cleanedPhoneNumber)) {
                    finalTargetId = cleanedPhoneNumber; 
                    targetDisplayName = cleanedPhoneNumber;
                    ctx.scene.session.state.target = finalTargetId; 
                    ctx.scene.session.state.targetDisplayName = targetDisplayName; 
                    await ctx.reply(`Target (Pribadi - Nomor): ${targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                    ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT); 
                    return; 
                } else {
                    logger.info(`[SCENE] Input personal bukan nomor, mencoba mencari kontak dengan nama: "${targetInput}"`);
                    const matchedContacts = findContactsByName(targetInput);
                    if (matchedContacts.length === 1) {
                        const contact = matchedContacts[0];
                        targetDisplayName = contact.name;
                        logger.info(`Ditemukan 1 kontak: ${targetDisplayName} (${contact.number})`);
                        ctx.scene.session.state.pendingContactConfirmation = contact; // Simpan kontak untuk konfirmasi
                        await ctx.reply(`Apakah maksud Anda: ${contact.name} (${contact.number})?\nKirim "ya" atau "tidak", atau /batalscene.`);
                        ctx.wizard.selectStep(STEP_HANDLE_CHOICES_CONFIRMATION); 
                        return;
                    } else if (matchedContacts.length > 1) {
                        logger.info(`Ditemukan ${matchedContacts.length} kontak dengan nama mirip.`);
                        ctx.scene.session.state.contactChoices = matchedContacts.slice(0, 5); 
                        const buttons = ctx.scene.session.state.contactChoices.map((contact, index) => 
                            Markup.button.callback(`${contact.name} (${contact.number})`, `select_contact_${index}`)
                        );
                        await ctx.reply('Ditemukan beberapa kontak yang cocok. Silakan pilih salah satu atau kirim /batalscene:', Markup.inlineKeyboard(buttons, { columns: 1 }));
                        ctx.wizard.selectStep(STEP_HANDLE_CHOICES_CONFIRMATION); 
                        return; 
                    } else {
                        await ctx.reply('Nomor telepon tidak valid dan tidak ada kontak yang ditemukan dengan nama tersebut. Coba lagi.\nKirim /batalscene.');
                        return; 
                    }
                }
            } else if (targetType === 'group') {
                // ... (Logika grup tetap sama seperti sebelumnya)
                const inviteCode = extractInviteCode(targetInput);
                if (inviteCode) { 
                    await ctx.reply(`Memproses link grup, mohon tunggu...`);
                    const joinResult = await joinGroupByInviteAndGetInfo(inviteCode);
                    if (joinResult.success && joinResult.groupId) {
                        ctx.scene.session.state.target = joinResult.groupId; 
                        ctx.scene.session.state.targetDisplayName = joinResult.groupName || joinResult.groupId; 
                        await ctx.reply(joinResult.message); 
                        await ctx.reply(`Target (Grup): ${ctx.scene.session.state.targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                        ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT); 
                        return; 
                    } else if (joinResult.needsName) {
                        ctx.scene.session.state.tempInviteCode = inviteCode; 
                        await ctx.reply(`${joinResult.message}\nSilakan masukkan nama grup tersebut:`);
                        ctx.wizard.selectStep(STEP_HANDLE_CHOICES_CONFIRMATION); // Ke langkah proses nama grup
                        return; 
                    } else { /* ... (gagal proses link) ... */ await ctx.reply(`Gagal memproses link grup: ${joinResult.message}\nCoba lagi atau /batalscene.`); return; }
                } else if (isValidWhatsAppGroupId(targetInput)) { /* ... (ID grup valid) ... */ 
                    ctx.scene.session.state.target = targetInput; 
                    try { const chat = await getWhatsAppClient().getChatById(targetInput); ctx.scene.session.state.targetDisplayName = chat ? chat.name : targetInput; } 
                    catch (e) { ctx.scene.session.state.targetDisplayName = targetInput; }
                    await ctx.reply(`Target (Grup): ${ctx.scene.session.state.targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                    ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT); return;
                } else { /* ... (cari nama grup) ... */ 
                    const foundGroups = findGroupByName(targetInput);
                    if (foundGroups.length === 1) {
                        ctx.scene.session.state.target = foundGroups[0].id; 
                        ctx.scene.session.state.targetDisplayName = foundGroups[0].name; 
                        await ctx.reply(`Target (Grup): ${ctx.scene.session.state.targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                        ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT); return; 
                    } else if (foundGroups.length > 1) { /* ... */ await ctx.reply('Ditemukan beberapa grup dengan nama mirip...'); return; }
                    else { /* ... */ await ctx.reply('Grup tidak ditemukan...'); return; }
                }
            }
            logger.warn(`[SCENE] Langkah ${ctx.wizard.cursor}: Alur tidak terduga.`);
            await ctx.reply('Terjadi kesalahan alur. Coba lagi /start.');
            return ctx.scene.leave();

        } catch (e) { logger.error(`[SCENE] Error di Langkah ${ctx.wizard.cursor} (Menangani Tujuan):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 2: (Opsional) Tangani input nama grup jika 'needsName' ATAU konfirmasi/pilihan kontak
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah ${ctx.wizard.cursor} (Proses Nama Grup/Pilihan/Konfirmasi Kontak). User: ${ctx.from.id}`);
        try {
            if (!ctx.scene.session.state) { /* ... */ return ctx.scene.leave(); }

            // Kasus 1: Menangani konfirmasi kontak tunggal (ya/tidak) dari pesan teks
            if (ctx.scene.session.state.pendingContactConfirmation && ctx.message && ctx.message.text) {
                const confirmation = ctx.message.text.toLowerCase().trim();
                const pendingContact = ctx.scene.session.state.pendingContactConfirmation;
                if (confirmation === 'ya') {
                    ctx.scene.session.state.target = pendingContact.id;
                    ctx.scene.session.state.targetDisplayName = pendingContact.name;
                    delete ctx.scene.session.state.pendingContactConfirmation;
                    delete ctx.scene.session.state.contactChoices; 
                    await ctx.reply(`Kontak "${pendingContact.name}" dikonfirmasi.\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                    ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT);
                    return;
                } else if (confirmation === 'tidak') {
                    delete ctx.scene.session.state.pendingContactConfirmation;
                    await ctx.reply('Baik, silakan masukkan nama kontak atau nomor telepon yang benar, atau /batalscene untuk keluar.');
                    ctx.wizard.selectStep(STEP_PROCESS_INITIAL_TARGET); // Kembali ke langkah input target awal
                    return;
                } else {
                    await ctx.reply(`Pilihan tidak valid ("${confirmation}"). Apakah kontak "${pendingContact.name}" (${pendingContact.number}) benar? (ya/tidak)`);
                    return; 
                }
            } 
            // Kasus 2: Menangani input nama grup setelah 'needsName'
            else if (ctx.scene.session.state.tempInviteCode && ctx.message && ctx.message.text) {
                const groupNameInput = ctx.message.text.trim();
                const foundGroups = findGroupByName(groupNameInput);
                if (foundGroups.length === 1) {
                    const group = foundGroups[0];
                    ctx.scene.session.state.target = group.id;
                    ctx.scene.session.state.targetDisplayName = group.name;
                    delete ctx.scene.session.state.tempInviteCode;
                    await ctx.reply(`Grup ditemukan: "${group.name}".\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                    ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT); 
                    return; 
                } else { 
                    await ctx.reply(`Grup dengan nama "${groupNameInput}" tidak ditemukan atau ambigu. Coba lagi atau /batalscene.`);
                    return;
                }
            } 
            // Kasus 3: Callback dari pilihan kontak (sudah ditangani oleh scheduleScene.action terpisah)
            // Jika kita sampai sini dan itu adalah callback, biarkan handler action yang menanganinya.
            // Jika itu pesan teks biasa yang tidak cocok dengan kondisi di atas:
            else if (ctx.message && ctx.message.text) {
                 logger.warn(`[SCENE] Langkah ${ctx.wizard.cursor}: Input teks "${ctx.message.text}" tidak diharapkan pada langkah ini.`);
                 await ctx.reply('Input tidak diharapkan. Mohon ikuti instruksi atau /batalscene.');
                 return; // Tetap di langkah ini
            } else if (!ctx.callbackQuery) { 
                logger.warn(`[SCENE] Langkah ${ctx.wizard.cursor}: Masuk ke langkah ini tanpa kondisi yang diharapkan.`);
                await ctx.reply('Terjadi kesalahan alur. Mohon mulai ulang /start atau /batalscene.');
                return ctx.scene.leave();
            }
            // Jika ini adalah callback query yang belum ditangani, kita tidak melakukan apa-apa di sini
            // karena akan ditangani oleh scheduleScene.action(/select_contact_(\d+)/, ...)
            return; 
        } catch (e) { logger.error(`[SCENE] Error di Langkah ${ctx.wizard.cursor}:`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 3: Minta dan tangani isi pesan
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah ${ctx.wizard.cursor} (Isi Pesan). User: ${ctx.from.id}`);
        try {
            if (!ctx.scene.session.state || !ctx.scene.session.state.target) { 
                 logger.error(`[SCENE] Langkah ${ctx.wizard.cursor}: State target tidak ada!`);
                 await ctx.reply('Terjadi kesalahan (target tidak tersimpan). Membatalkan.');
                 return ctx.scene.leave();
            }
            if (!ctx.message || !ctx.message.text) { 
                logger.warn(`[SCENE] Langkah ${ctx.wizard.cursor}: Input isi pesan tidak valid (bukan teks). User: ${ctx.from.id}`);
                await ctx.reply('Input isi pesan tidak valid. Silakan masukkan teks pesan. Kirim /batalscene.');
                return; 
            }
            const messageText = ctx.message.text.trim();
            logger.info(`[SCENE] Langkah ${ctx.wizard.cursor}: Isi pesan diterima: "${messageText}"`);
            if (!messageText) { 
                await ctx.reply('Isi pesan tidak boleh kosong. Kirim /batalscene.');
                return; 
            }

            ctx.scene.session.state.text = messageText;
            await ctx.reply(`Isi pesan: "${messageText}"\n\nSekarang masukkan waktu dan tanggal penjadwalan.\nFormat: HH:MM DD/MM/YYYY (Contoh: 17:00 25/12/2025).\n\nKirim /batalscene untuk keluar.`);
            return ctx.wizard.next();
        } catch (e) { logger.error(`[SCENE] Error di Langkah ${ctx.wizard.cursor} (Isi Pesan):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 4: Minta dan tangani input tanggal/waktu, proses penjadwalan
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah ${ctx.wizard.cursor} (Tanggal/Waktu). User: ${ctx.from.id}`);
        try {
            if (!ctx.scene.session.state || !ctx.scene.session.state.target || !ctx.scene.session.state.text) { 
                logger.error(`[SCENE] Langkah ${ctx.wizard.cursor}: State tidak lengkap!`);
                await ctx.reply('Terjadi kesalahan (data tidak lengkap). Membatalkan.');
                return ctx.scene.leave();
            }
            if (!ctx.message || !ctx.message.text) { 
                logger.warn(`[SCENE] Langkah ${ctx.wizard.cursor}: Input tanggal/waktu tidak valid (bukan teks). User: ${ctx.from.id}`);
                await ctx.reply('Input tanggal/waktu tidak valid. Kirim /batalscene.');
                return; 
            }
            const dateTimeInput = ctx.message.text.trim();
            logger.info(`[SCENE] Langkah ${ctx.wizard.cursor}: Input tanggal/waktu diterima: "${dateTimeInput}"`);
            const parts = dateTimeInput.split(' ');
            const timeStr = parts[0];
            const dateStr = parts[1];
            if (!timeStr || !dateStr || parts.length !== 2) { 
                await ctx.reply('Format tanggal/waktu salah. Contoh: 17:00 25/12/2025'); 
                return; 
            }
            const parsedDateTime = parseDateTime(timeStr, dateStr);
            if (!parsedDateTime) { 
                await ctx.reply('Tanggal/waktu tidak valid. Contoh: 17:00 25/12/2025'); 
                return; 
            }
            const now = new Date();
            const oneMinuteLater = new Date(now.getTime() + 60000);
            if (parsedDateTime <= oneMinuteLater) { 
                await ctx.reply('Waktu harus di masa depan (min. 1 menit).'); 
                return; 
            }
            if (!isReady()) { 
                await ctx.reply('Klien WA tidak siap.'); 
                return ctx.scene.leave(); 
            }

            const { target, text, targetDisplayName } = ctx.scene.session.state; 
            const schedule = { target, dateTime: parsedDateTime.toISOString(), text, userId: ctx.from.id, sent: false };
            await ctx.reply('Sedang menyimpan jadwal, mohon tunggu sebentar...');
            const savedSchedule = storageService.addScheduledMessage(schedule);
            await delay(500); 
            logger.info(`[SCENE] Pesan dijadwalkan untuk ${targetDisplayName || target} ID: ${savedSchedule.id}`);
            const userFriendlyDateTime = parsedDateTime.toLocaleString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });
            await ctx.reply(`✅ Pesan untuk "${targetDisplayName || target}" berhasil dijadwalkan pada ${userFriendlyDateTime} (ID: ${savedSchedule.id})`);
        
        } catch (e) { logger.error(`[SCENE] Error di Langkah ${ctx.wizard.cursor} (Tanggal/Waktu):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
        return ctx.scene.leave(); 
    }
);

scheduleScene.command('batalscene', async (ctx) => {
    logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Perintah /batalscene diterima. User: ${ctx.from.id}`);
    await ctx.reply('Penjadwalan dibatalkan.');
    return ctx.scene.leave();
});

// Handler untuk callback query pilihan kontak di dalam scene
scheduleScene.action(/select_contact_(\d+)/, async (ctx) => {
    logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Menerima callback pilihan kontak. User: ${ctx.from.id}`);
    try {
        // Pastikan kita berada di langkah yang tepat untuk menangani ini (setelah tombol pilihan ditampilkan)
        if (ctx.wizard.cursor !== STEP_HANDLE_CHOICES_CONFIRMATION) {
            logger.warn(`[SCENE] Callback pilihan kontak diterima di langkah yang salah: ${ctx.wizard.cursor}, diharapkan: ${STEP_HANDLE_CHOICES_CONFIRMATION}`);
            await ctx.answerCbQuery('Aksi tidak valid saat ini.');
            // Jangan keluar scene, biarkan pengguna mungkin mencoba lagi atau /batalscene
            return; 
        }
        if (!ctx.scene.session.state || !ctx.scene.session.state.contactChoices) {
            logger.warn('[SCENE] Pilihan kontak diterima tapi state contactChoices tidak ada.');
            await ctx.answerCbQuery('Pilihan tidak valid atau sesi berakhir.');
            return ctx.scene.reenter(); 
        }
        const choiceIndex = parseInt(ctx.match[1], 10);
        const choices = ctx.scene.session.state.contactChoices;

        if (choices && choices[choiceIndex]) {
            const selectedContact = choices[choiceIndex];
            ctx.scene.session.state.target = selectedContact.id; 
            ctx.scene.session.state.targetDisplayName = selectedContact.name;
            delete ctx.scene.session.state.contactChoices; 
            delete ctx.scene.session.state.pendingContactConfirmation; // Hapus juga ini jika ada
            
            await ctx.answerCbQuery(`Kontak "${selectedContact.name}" dipilih.`);
            try {
                await ctx.editMessageText(`Kontak dipilih: ${selectedContact.name}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`, Markup.removeKeyboard());
            } catch (e) {
                logger.warn('Gagal edit pesan setelah pilih kontak, mengirim reply baru', e);
                await ctx.reply(`Kontak dipilih: ${selectedContact.name}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
            }
            
            ctx.wizard.selectStep(STEP_ASK_MESSAGE_CONTENT);
            return; 
        } else { 
            await ctx.answerCbQuery('Pilihan kontak tidak valid.');
            await ctx.reply('Pilihan kontak tidak valid, coba lagi atau /batalscene.');
            return ctx.scene.leave();
        }
    } catch (error) { 
        logger.error('[SCENE] Error menangani pilihan kontak:', error);
        await ctx.answerCbQuery('Error memproses pilihan.');
        await ctx.reply('Terjadi kesalahan. Coba lagi.');
        return ctx.scene.leave();
    }
});


module.exports = scheduleScene;
