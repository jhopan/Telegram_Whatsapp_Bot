// src/telegram/scenes/personalScheduleScene.js
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const { parseDateTime } = require('../../utils/dateTimeParser');
const storageService = require('../../services/storageService');
const { isReady, findContactsByName } = require('../../whatsapp/client');

const PERSONAL_SCHEDULE_WIZARD_ID = 'personalScheduleWizard';

const isValidWhatsAppNumber = (number) => {
    const cleaned = String(number).replace(/[\s-()+]/g, '');
    return /^(628[0-9]{8,13}|08[0-9]{8,13})$/.test(cleaned);
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const STEP_ASK_TARGET = 0;
const STEP_PROCESS_TARGET = 1;
const STEP_HANDLE_CONFIRMATION = 2;
const STEP_ASK_MESSAGE = 3;
const STEP_PROCESS_DATETIME = 4;

const personalScheduleScene = new Scenes.WizardScene(
    PERSONAL_SCHEDULE_WIZARD_ID,
    // Langkah 0: Minta target pribadi
    async (ctx) => {
        logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Minta Target Pribadi).`);
        await ctx.reply('Silakan masukkan nomor WhatsApp tujuan atau sebagian nama kontak yang tersimpan.\n\nKirim /batalscene untuk keluar.');
        return ctx.wizard.next();
    },
    // Langkah 1: Proses input target pribadi
    async (ctx) => {
        logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Proses Target Pribadi).`);
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Input tidak valid. Mohon masukkan nomor atau nama kontak, atau /batalscene.');
            return;
        }
        const targetInput = ctx.message.text.trim();
        const cleanedPhoneNumber = targetInput.replace(/[<>]/g, '').replace(/[\s-()]/g, '');

        if (isValidWhatsAppNumber(cleanedPhoneNumber)) {
            ctx.scene.session.state = { target: cleanedPhoneNumber + '@c.us', targetDisplayName: cleanedPhoneNumber }; // Tambahkan @c.us untuk ID WA
            await ctx.reply(`Target: ${cleanedPhoneNumber}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
            ctx.wizard.selectStep(STEP_ASK_MESSAGE);
            return;
        } else {
            const matchedContacts = findContactsByName(targetInput);
            if (matchedContacts.length === 1) {
                const contact = matchedContacts[0];
                ctx.scene.session.state = { pendingContactConfirmation: contact };
                await ctx.reply(`Apakah maksud Anda: ${contact.name} (${contact.number})?\nKirim "ya" atau "tidak", atau /batalscene.`);
                ctx.wizard.selectStep(STEP_HANDLE_CONFIRMATION);
            } else if (matchedContacts.length > 1) {
                ctx.scene.session.state = { contactChoices: matchedContacts.slice(0, 5) };
                const buttons = ctx.scene.session.state.contactChoices.map((contact, index) =>
                    Markup.button.callback(`${contact.name} (${contact.number})`, `select_contact_${index}`)
                );
                await ctx.reply('Ditemukan beberapa kontak. Pilih salah satu atau /batalscene:', Markup.inlineKeyboard(buttons, { columns: 1 }));
                ctx.wizard.selectStep(STEP_HANDLE_CONFIRMATION);
            } else {
                await ctx.reply('Nomor tidak valid dan kontak tidak ditemukan. Coba lagi atau /batalscene.');
            }
        }
    },
    // Langkah 2: Tangani konfirmasi/pilihan kontak
    async (ctx) => {
        logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Handle Konfirmasi).`);
        if (!ctx.scene.session.state) return ctx.scene.leave();

        if (ctx.scene.session.state.pendingContactConfirmation && ctx.message && ctx.message.text) {
            const confirmation = ctx.message.text.toLowerCase().trim();
            const pendingContact = ctx.scene.session.state.pendingContactConfirmation;
            if (confirmation === 'ya') {
                ctx.scene.session.state.target = pendingContact.id;
                ctx.scene.session.state.targetDisplayName = pendingContact.name;
                delete ctx.scene.session.state.pendingContactConfirmation;
                await ctx.reply(`Kontak "${pendingContact.name}" dikonfirmasi.\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                ctx.wizard.selectStep(STEP_ASK_MESSAGE);
            } else if (confirmation === 'tidak') {
                delete ctx.scene.session.state.pendingContactConfirmation;
                await ctx.reply('Baik, silakan masukkan nama atau nomor yang benar, atau /batalscene.');
                ctx.wizard.selectStep(STEP_PROCESS_TARGET);
            } else {
                await ctx.reply(`Pilihan tidak valid. Apakah kontak "${pendingContact.name}" (${pendingContact.number}) benar? (ya/tidak)`);
            }
        } else if (ctx.callbackQuery) {
            // Biarkan handler action yang menangani callback
        } else {
            await ctx.reply('Input tidak diharapkan. Mohon ikuti instruksi atau /batalscene.');
        }
    },
    // Langkah 3: Minta isi pesan
    async (ctx) => {
        logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Minta Pesan).`);
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Input tidak valid. Mohon masukkan isi pesan atau /batalscene.');
            return;
        }
        ctx.scene.session.state.text = ctx.message.text.trim();
        await ctx.reply(`Isi pesan: "${ctx.scene.session.state.text}"\n\nSekarang masukkan waktu dan tanggal penjadwalan (HH:MM DD/MM/YYYY).\nContoh: 17:00 25/12/2025\nKirim /batalscene.`);
        return ctx.wizard.next();
    },
    // Langkah 4: Proses tanggal/waktu dan simpan
    async (ctx) => {
        logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Proses Waktu).`);
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Input tidak valid. Mohon masukkan tanggal/waktu atau /batalscene.');
            return;
        }
        const dateTimeInput = ctx.message.text.trim();
        const parts = dateTimeInput.split(' ');
        if (parts.length !== 2) {
            await ctx.reply('Format salah. Contoh: 17:00 25/12/2025'); return;
        }
        const parsedDateTime = parseDateTime(parts[0], parts[1]);
        if (!parsedDateTime || parsedDateTime <= new Date(new Date().getTime() + 60000)) {
            await ctx.reply('Tanggal/waktu tidak valid atau sudah lewat (min. 1 menit). Coba lagi.'); return;
        }
        if (!isReady()) { await ctx.reply('Klien WA tidak siap.'); return ctx.scene.leave(); }

        const { target, text, targetDisplayName } = ctx.scene.session.state;
        const schedule = { target, dateTime: parsedDateTime.toISOString(), text, userId: ctx.from.id, sent: false };
        await ctx.reply('Menyimpan jadwal...');
        const savedSchedule = storageService.addScheduledMessage(schedule);
        await delay(500);
        const userFriendlyDateTime = parsedDateTime.toLocaleString('id-ID', { /* ... opsi format ... */ timeZone: 'Asia/Makassar' });
        await ctx.reply(`✅ Pesan untuk "${targetDisplayName || target}" berhasil dijadwalkan pada ${userFriendlyDateTime} (ID: ${savedSchedule.id})`);
        return ctx.scene.leave();
    }
);

personalScheduleScene.command('batalscene', async (ctx) => {
    logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Perintah /batalscene diterima.`);
    await ctx.reply('Penjadwalan pribadi dibatalkan.');
    return ctx.scene.leave();
});

personalScheduleScene.action(/select_contact_(\d+)/, async (ctx) => {
    logger.info(`[SCENE: ${PERSONAL_SCHEDULE_WIZARD_ID}] Callback pilihan kontak.`);
    if (ctx.wizard.cursor !== STEP_HANDLE_CONFIRMATION) {
        await ctx.answerCbQuery('Aksi tidak valid saat ini.'); return;
    }
    if (!ctx.scene.session.state || !ctx.scene.session.state.contactChoices) {
        await ctx.answerCbQuery('Pilihan tidak valid.'); return ctx.scene.reenter();
    }
    const choiceIndex = parseInt(ctx.match[1], 10);
    const choices = ctx.scene.session.state.contactChoices;
    if (choices && choices[choiceIndex]) {
        const selectedContact = choices[choiceIndex];
        ctx.scene.session.state.target = selectedContact.id;
        ctx.scene.session.state.targetDisplayName = selectedContact.name;
        delete ctx.scene.session.state.contactChoices;
        delete ctx.scene.session.state.pendingContactConfirmation;
        await ctx.answerCbQuery(`Kontak "${selectedContact.name}" dipilih.`);
        await ctx.editMessageText(`Kontak: ${selectedContact.name}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
        ctx.wizard.selectStep(STEP_ASK_MESSAGE);
    } else {
        await ctx.answerCbQuery('Pilihan tidak valid.'); await ctx.reply('Pilihan tidak valid.'); return ctx.scene.leave();
    }
});

module.exports = personalScheduleScene;