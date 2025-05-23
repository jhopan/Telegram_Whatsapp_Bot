// src/telegram/scenes/groupScheduleScene.js
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const { parseDateTime } = require('../../utils/dateTimeParser');
const storageService = require('../../services/storageService');
const {
    isReady,
    joinGroupByInviteAndGetInfo,
    findGroupByName,
    getWhatsAppClient
} = require('../../whatsapp/client');

const GROUP_SCHEDULE_WIZARD_ID = 'groupScheduleWizard';

const isValidWhatsAppGroupId = (id) => typeof id === 'string' && /^[0-9@._-]+@g\.us$/.test(id.trim());
function extractInviteCode(link) {
    if (typeof link !== 'string') return null;
    const match = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]{18,24})/);
    return match ? match[1] : null;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const STEP_ASK_TARGET = 0;
const STEP_PROCESS_TARGET = 1;
const STEP_HANDLE_GROUP_NAME = 2; // Hanya untuk 'needsName'
const STEP_ASK_MESSAGE = 3;
const STEP_PROCESS_DATETIME = 4;


const groupScheduleScene = new Scenes.WizardScene(
    GROUP_SCHEDULE_WIZARD_ID,
    // Langkah 0: Minta target grup
    async (ctx) => {
        logger.info(`[SCENE: ${GROUP_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Minta Target Grup).`);
        await ctx.reply('Silakan masukkan link undangan grup WhatsApp, ID Grup, atau nama grup.\n\nKirim /batalscene untuk keluar.');
        return ctx.wizard.next();
    },
    // Langkah 1: Proses input target grup
    async (ctx) => {
        logger.info(`[SCENE: ${GROUP_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Proses Target Grup).`);
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Input tidak valid. Mohon masukkan target grup atau /batalscene.');
            return;
        }
        const targetInput = ctx.message.text.trim();
        ctx.scene.session.state = {}; // Reset state

        const inviteCode = extractInviteCode(targetInput);
        if (inviteCode) {
            await ctx.reply(`Memproses link grup, mohon tunggu...`);
            const joinResult = await joinGroupByInviteAndGetInfo(inviteCode);
            if (joinResult.success && joinResult.groupId) {
                ctx.scene.session.state.target = joinResult.groupId;
                ctx.scene.session.state.targetDisplayName = joinResult.groupName || joinResult.groupId;
                await ctx.reply(`${joinResult.message}\nTarget: ${ctx.scene.session.state.targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                ctx.wizard.selectStep(STEP_ASK_MESSAGE);
            } else if (joinResult.needsName) {
                ctx.scene.session.state.tempInviteCode = inviteCode;
                await ctx.reply(`${joinResult.message}\nSilakan masukkan nama grup tersebut:`);
                ctx.wizard.selectStep(STEP_HANDLE_GROUP_NAME);
            } else {
                await ctx.reply(`Gagal memproses link grup: ${joinResult.message}\nCoba lagi atau /batalscene.`);
            }
        } else if (isValidWhatsAppGroupId(targetInput)) {
            ctx.scene.session.state.target = targetInput;
            try { const chat = await getWhatsAppClient().getChatById(targetInput); ctx.scene.session.state.targetDisplayName = chat ? chat.name : targetInput; }
            catch (e) { ctx.scene.session.state.targetDisplayName = targetInput; }
            await ctx.reply(`Target: ${ctx.scene.session.state.targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
            ctx.wizard.selectStep(STEP_ASK_MESSAGE);
        } else {
            const foundGroups = findGroupByName(targetInput);
            if (foundGroups.length === 1) {
                ctx.scene.session.state.target = foundGroups[0].id;
                ctx.scene.session.state.targetDisplayName = foundGroups[0].name;
                await ctx.reply(`Target: ${ctx.scene.session.state.targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                ctx.wizard.selectStep(STEP_ASK_MESSAGE);
            } else if (foundGroups.length > 1) {
                // TODO: Tambahkan pilihan grup jika ditemukan > 1
                await ctx.reply('Ditemukan beberapa grup. Fitur ini belum mendukung pilihan. Coba nama yang lebih spesifik atau ID/Link.');
            } else {
                await ctx.reply('Grup tidak ditemukan. Coba lagi dengan link, ID, atau nama yang benar, atau /batalscene.');
            }
        }
    },
    // Langkah 2: Tangani input nama grup jika 'needsName'
    async (ctx) => {
        logger.info(`[SCENE: ${GROUP_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Handle Nama Grup).`);
        if (!ctx.scene.session.state || !ctx.scene.session.state.tempInviteCode || !ctx.message || !ctx.message.text) {
             await ctx.reply('Input tidak valid atau sesi berakhir. Coba lagi atau /batalscene.');
             return ctx.scene.leave();
        }
        const groupNameInput = ctx.message.text.trim();
        const foundGroups = findGroupByName(groupNameInput); // Cari lagi untuk memastikan
        if (foundGroups.length === 1) {
            const group = foundGroups[0];
            ctx.scene.session.state.target = group.id;
            ctx.scene.session.state.targetDisplayName = group.name;
            delete ctx.scene.session.state.tempInviteCode;
            await ctx.reply(`Grup: "${group.name}" dikonfirmasi.\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
            ctx.wizard.selectStep(STEP_ASK_MESSAGE);
        } else {
            await ctx.reply(`Grup dengan nama "${groupNameInput}" tidak ditemukan atau ambigu. Coba lagi atau /batalscene.`);
        }
    },
    // Langkah 3: Minta isi pesan (Sama seperti personal)
    async (ctx) => {
        logger.info(`[SCENE: ${GROUP_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Minta Pesan).`);
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Input tidak valid. Mohon masukkan isi pesan atau /batalscene.');
            return;
        }
        ctx.scene.session.state.text = ctx.message.text.trim();
        await ctx.reply(`Isi pesan: "${ctx.scene.session.state.text}"\n\nSekarang masukkan waktu dan tanggal penjadwalan (HH:MM DD/MM/YYYY).\nContoh: 17:00 25/12/2025\nKirim /batalscene.`);
        return ctx.wizard.next();
    },
    // Langkah 4: Proses tanggal/waktu dan simpan (Sama seperti personal)
    async (ctx) => {
        logger.info(`[SCENE: ${GROUP_SCHEDULE_WIZARD_ID}] Langkah ${ctx.wizard.cursor} (Proses Waktu).`);
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

groupScheduleScene.command('batalscene', async (ctx) => {
    logger.info(`[SCENE: ${GROUP_SCHEDULE_WIZARD_ID}] Perintah /batalscene diterima.`);
    await ctx.reply('Penjadwalan grup dibatalkan.');
    return ctx.scene.leave();
});

module.exports = groupScheduleScene;