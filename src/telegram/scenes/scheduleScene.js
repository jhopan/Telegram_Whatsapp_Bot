// src/telegram/scenes/scheduleScene.js
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const { parseDateTime } = require('../../utils/dateTimeParser'); 
const storageService = require('../../services/storageService');
const { isReady, joinGroupByInviteAndGetInfo, findGroupByName, getWhatsAppClient } = require('../../whatsapp/client'); 

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

// Urutan langkah-langkah wizard (0-indexed)
// 0: Minta target awal (nomor/link/ID/nama grup)
// 1: Proses target awal. 
//    - Jika target valid & final -> simpan, minta isi pesan, ctx.wizard.selectStep(2) dan return;
//    - Jika target link & needsName -> simpan tempInviteCode, minta nama grup, ctx.wizard.next() dan return;
// 2: (Opsional) Tangani input nama grup jika 'needsName'. Setelah selesai, minta isi pesan, ctx.wizard.selectStep(2) (ke langkah yang sama, tapi sekarang akan jadi langkah isi pesan) dan return;
//    Perlu penyesuaian: Langkah untuk isi pesan harus memiliki indeks yang berbeda.
//
// REVISI ALUR LANGKAH:
// Wizard Steps Array:
// Handler 0 (indeks 0): `askInitialTargetHandler` - Meminta target awal (nomor/link/ID/nama)
// Handler 1 (indeks 1): `processInitialTargetHandler` - Memproses input target.
//                      - Jika valid & final (nomor, ID, nama grup ketemu, link berhasil join tanpa needsName) -> simpan target, minta isi pesan, `ctx.wizard.selectStep(3)` (lompat ke handler isi pesan), `return;`
//                      - Jika link & `needsName` -> simpan `tempInviteCode`, minta nama grup, `return ctx.wizard.next();` (maju ke handler nama grup)
//                      - Jika tidak valid -> minta input lagi, `return;`
// Handler 2 (indeks 2): `processGroupNameAfterNeedsNameHandler` - (Hanya jika `needsName`) Memproses nama grup.
//                      - Jika nama grup ketemu -> simpan target, minta isi pesan, `ctx.wizard.selectStep(3)` (lompat ke handler isi pesan), `return;`
//                      - Jika tidak ketemu -> minta nama lagi, `return;`
// Handler 3 (indeks 3): `askForMessageContentHandler` (sebelumnya `processMessageContentHandler`) - Menerima isi pesan.
//                      - Simpan isi pesan, minta tanggal/waktu, `return ctx.wizard.next();`
// Handler 4 (indeks 4): `processDateTimeAndScheduleHandler` - Menerima tanggal/waktu, proses, dan keluar.


const scheduleScene = new Scenes.WizardScene(
    SCHEDULE_WIZARD_SCENE_ID,
    // Langkah 0: Minta target awal
    async (ctx) => {
        const targetType = ctx.session.scheduleTargetType; 
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah 0: Meminta Tujuan. User: ${ctx.from.id}, TargetType: ${targetType}`);
        try {
            ctx.scene.session.state = { targetType }; 
            logger.info(`[SCENE] Langkah 0: state diinisialisasi dengan targetType: ${targetType}`);

            let promptMessage = 'Baik, mari kita jadwalkan pesan.\n\n';
            if (targetType === 'personal') {
                promptMessage += 'Silakan masukkan nomor WhatsApp tujuan (contoh: 08123456789 atau 6281234567890).';
            } else if (targetType === 'group') {
                promptMessage += 'Silakan masukkan link undangan grup WhatsApp, ID Grup (jika diketahui), atau nama grup (jika bot sudah menjadi anggota).';
            } else { 
                logger.error(`[SCENE] Langkah 0: targetType tidak diketahui: "${targetType}".`);
                await ctx.reply('Tipe target tidak diketahui. Proses dibatalkan.');
                return ctx.scene.leave();
            }
            promptMessage += '\n\nKirim /batalscene untuk keluar.';
            await ctx.reply(promptMessage);
            return ctx.wizard.next(); // Maju ke Langkah 1 (penanganan input target)
        } catch (e) { logger.error(`[SCENE] Error di Langkah 0:`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 1: Tangani input target awal
    async (ctx) => {
        const { targetType } = ctx.scene.session.state;
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah 1: Menangani Tujuan. User: ${ctx.from.id}, TargetType: ${targetType}`);
        try {
            if (!ctx.scene.session.state) { await ctx.reply('State error, coba lagi.'); return ctx.scene.leave(); }
            if (!ctx.message || !ctx.message.text) { await ctx.reply('Input tidak valid, coba lagi.'); return; } // Tetap di langkah ini

            const targetInput = ctx.message.text.trim();
            logger.info(`[SCENE] Langkah 1: Target input: "${targetInput}"`);

            let finalTargetId = null;
            let targetDisplayName = targetInput;

            if (targetType === 'personal') {
                const cleanedPhoneNumber = targetInput.replace(/[<>]/g, '').replace(/[\s-()]/g, ''); 
                if (!isValidWhatsAppNumber(cleanedPhoneNumber)) {
                    await ctx.reply('Format nomor telepon pribadi tidak valid. Coba lagi.\nKirim /batalscene.');
                    return; // Tetap di langkah ini
                }
                finalTargetId = cleanedPhoneNumber; 
                targetDisplayName = cleanedPhoneNumber;
                ctx.scene.session.state.target = finalTargetId; 
                ctx.scene.session.state.targetDisplayName = targetDisplayName; 
                await ctx.reply(`Target (${targetType}): ${targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                ctx.wizard.selectStep(3); // Lompat ke Langkah 3 (indeks 3 - minta isi pesan)
                return; // Biarkan Telegraf menunggu input baru untuk langkah yang dipilih
            } else if (targetType === 'group') {
                const inviteCode = extractInviteCode(targetInput);
                if (inviteCode) { 
                    await ctx.reply(`Memproses link grup, mohon tunggu...`);
                    const joinResult = await joinGroupByInviteAndGetInfo(inviteCode);
                    if (joinResult.success && joinResult.groupId) {
                        finalTargetId = joinResult.groupId;
                        targetDisplayName = joinResult.groupName || finalTargetId;
                        await ctx.reply(joinResult.message); 
                        ctx.scene.session.state.target = finalTargetId; 
                        ctx.scene.session.state.targetDisplayName = targetDisplayName; 
                        await ctx.reply(`Target (${targetType}): ${targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                        ctx.wizard.selectStep(3); // Lompat ke Langkah 3 (indeks 3 - minta isi pesan)
                        return; 
                    } else if (joinResult.needsName) {
                        ctx.scene.session.state.tempInviteCode = inviteCode; 
                        await ctx.reply(`${joinResult.message}\nSilakan masukkan nama grup tersebut:`);
                        return ctx.wizard.next(); // Maju ke Langkah 2 (untuk input nama grup)
                    } else {
                        await ctx.reply(`Gagal memproses link grup: ${joinResult.message}\nCoba lagi atau /batalscene.`);
                        return; 
                    }
                } else if (isValidWhatsAppGroupId(targetInput)) { 
                    finalTargetId = targetInput;
                    try {
                        const chat = await getWhatsAppClient().getChatById(finalTargetId);
                        targetDisplayName = chat ? chat.name : finalTargetId;
                    } catch (e) { targetDisplayName = finalTargetId; }
                    ctx.scene.session.state.target = finalTargetId; 
                    ctx.scene.session.state.targetDisplayName = targetDisplayName; 
                    await ctx.reply(`Target (${targetType}): ${targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                    ctx.wizard.selectStep(3); // Lompat ke Langkah 3 (indeks 3 - minta isi pesan)
                    return;
                } else { 
                    const foundGroups = findGroupByName(targetInput);
                    if (foundGroups.length === 1) {
                        finalTargetId = foundGroups[0].id;
                        targetDisplayName = foundGroups[0].name;
                        ctx.scene.session.state.target = finalTargetId; 
                        ctx.scene.session.state.targetDisplayName = targetDisplayName; 
                        await ctx.reply(`Target (${targetType}): ${targetDisplayName}\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                        ctx.wizard.selectStep(3); // Lompat ke Langkah 3 (indeks 3 - minta isi pesan)
                        return; 
                    } else if (foundGroups.length > 1) {
                        await ctx.reply('Ditemukan beberapa grup dengan nama mirip. Mohon masukkan ID Grup atau link undangan, atau /batalscene.');
                        return;
                    } else {
                        await ctx.reply('Grup tidak ditemukan. Pastikan bot anggota grup jika menggunakan nama, atau link/ID benar.\nKirim /batalscene.');
                        return; 
                    }
                }
            }
            // Jika tidak ada kondisi di atas yang terpenuhi atau tidak ada return eksplisit,
            // ini bisa jadi masalah. Seharusnya setiap cabang logika memiliki return.
            logger.warn(`[SCENE] Langkah 1: Tidak ada kondisi yang cocok untuk memproses target atau melompat.`);
            await ctx.reply('Terjadi kesalahan dalam alur. Silakan coba lagi atau /batalscene.');
            return ctx.scene.leave();

        } catch (e) { logger.error(`[SCENE] Error di Langkah 1 (Menangani Tujuan):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 2 (indeks 2): HANYA untuk menangani input nama grup jika `needsName` dari langkah sebelumnya
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah 2 (Input Nama Grup). User: ${ctx.from.id}`);
        try {
            if (!ctx.scene.session.state || !ctx.scene.session.state.tempInviteCode) {
                logger.warn(`[SCENE] Langkah 2 (Input Nama Grup): Masuk tanpa tempInviteCode. Mengabaikan pesan ini sebagai input untuk langkah ini.`);
                // Jangan reply, biarkan Telegraf mencoba mencocokkan dengan handler lain atau abaikan jika tidak ada.
                // Atau, jika ingin lebih ketat, bisa minta ulang atau keluar scene.
                // Untuk sekarang, kita return agar tidak diproses lebih lanjut oleh langkah ini.
                return; 
            }
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply('Input nama grup tidak valid. Kirim /batalscene.');
                return; 
            }
            const groupNameInput = ctx.message.text.trim();
            const foundGroups = findGroupByName(groupNameInput);

            if (foundGroups.length === 1) {
                const group = foundGroups[0];
                ctx.scene.session.state.target = group.id;
                ctx.scene.session.state.targetDisplayName = group.name;
                delete ctx.scene.session.state.tempInviteCode;
                await ctx.reply(`Grup ditemukan: "${group.name}".\n\nSekarang masukkan isi pesan.\nKirim /batalscene.`);
                ctx.wizard.selectStep(3); // Lompat ke Langkah 3 (indeks 3 - minta isi pesan)
                return; 
            } else if (foundGroups.length > 1) {
                await ctx.reply(`Ditemukan beberapa grup dengan nama "${groupNameInput}". Mohon berikan nama yang lebih spesifik, atau /batalscene.`);
                return; 
            } else {
                await ctx.reply(`Grup dengan nama "${groupNameInput}" tidak ditemukan. Coba lagi atau /batalscene.`);
                return; 
            }
        } catch (e) { logger.error(`[SCENE] Error di Langkah 2 (Input Nama Grup):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 3 (indeks 3): Tangani input isi pesan, minta waktu dan tanggal
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah 3 (Isi Pesan). User: ${ctx.from.id}`);
        try {
            if (!ctx.scene.session.state || !ctx.scene.session.state.target) { 
                 logger.error(`[SCENE] Langkah 3: State target tidak ada!`);
                 await ctx.reply('Terjadi kesalahan (target tidak tersimpan). Membatalkan.');
                 return ctx.scene.leave();
            }
            // Ini adalah input untuk ISI PESAN
            if (!ctx.message || !ctx.message.text) { 
                logger.warn(`[SCENE] Langkah 3: Input isi pesan tidak valid (bukan teks). User: ${ctx.from.id}`);
                await ctx.reply('Input isi pesan tidak valid. Silakan masukkan teks pesan. Kirim /batalscene.');
                return; // Tetap di langkah ini
            }
            const messageText = ctx.message.text.trim();
            logger.info(`[SCENE] Langkah 3: Isi pesan diterima: "${messageText}"`);
            if (!messageText) { 
                await ctx.reply('Isi pesan tidak boleh kosong. Kirim /batalscene.');
                return; // Tetap di langkah ini
            }

            ctx.scene.session.state.text = messageText;
            await ctx.reply(`Isi pesan: "${messageText}"\n\nSekarang masukkan waktu dan tanggal penjadwalan.\nFormat: HH:MM DD/MM/YYYY (Contoh: 17:00 25/12/2025).\n\nKirim /batalscene untuk keluar.`);
            return ctx.wizard.next(); // Maju ke Langkah 4 (minta tanggal/waktu)
        } catch (e) { logger.error(`[SCENE] Error di Langkah 3 (Isi Pesan):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
    },
    // Langkah 4 (indeks 4): Tangani input tanggal/waktu, proses penjadwalan
    async (ctx) => {
        logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Langkah 4 (Tanggal/Waktu). User: ${ctx.from.id}`);
        try {
            if (!ctx.scene.session.state || !ctx.scene.session.state.target || !ctx.scene.session.state.text) { 
                logger.error(`[SCENE] Langkah 4: State tidak lengkap!`);
                await ctx.reply('Terjadi kesalahan (data tidak lengkap). Membatalkan.');
                return ctx.scene.leave();
            }
            // Ini adalah input untuk TANGGAL/WAKTU
            if (!ctx.message || !ctx.message.text) { 
                logger.warn(`[SCENE] Langkah 4: Input tanggal/waktu tidak valid (bukan teks). User: ${ctx.from.id}`);
                await ctx.reply('Input tanggal/waktu tidak valid. Kirim /batalscene.');
                return; // Tetap di langkah ini
            }
            const dateTimeInput = ctx.message.text.trim();
            logger.info(`[SCENE] Langkah 4: Input tanggal/waktu diterima: "${dateTimeInput}"`);
            const parts = dateTimeInput.split(' ');
            const timeStr = parts[0];
            const dateStr = parts[1];
            if (!timeStr || !dateStr || parts.length !== 2) { 
                await ctx.reply('Format tanggal/waktu salah. Contoh: 17:00 25/12/2025'); 
                return; // Tetap di langkah ini
            }
            const parsedDateTime = parseDateTime(timeStr, dateStr);
            if (!parsedDateTime) { 
                await ctx.reply('Tanggal/waktu tidak valid. Contoh: 17:00 25/12/2025'); 
                return; // Tetap di langkah ini
            }
            const now = new Date();
            const oneMinuteLater = new Date(now.getTime() + 60000);
            if (parsedDateTime <= oneMinuteLater) { 
                await ctx.reply('Waktu harus di masa depan (min. 1 menit).'); 
                return; // Tetap di langkah ini
            }
            if (!isReady()) { 
                await ctx.reply('Klien WA tidak siap.'); 
                return ctx.scene.leave(); 
            }

            const { target, text, targetDisplayName } = ctx.scene.session.state; 
            const schedule = { target, dateTime: parsedDateTime.toISOString(), text, userId: ctx.from.id, sent: false };
            const savedSchedule = storageService.addScheduledMessage(schedule);
            logger.info(`[SCENE] Pesan dijadwalkan untuk ${targetDisplayName || target} ID: ${savedSchedule.id}`);
            const userFriendlyDateTime = parsedDateTime.toLocaleString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });
            await ctx.reply(`✅ Pesan untuk "${targetDisplayName || target}" berhasil dijadwalkan pada ${userFriendlyDateTime} (ID: ${savedSchedule.id})`);
        
        } catch (e) { logger.error(`[SCENE] Error di Langkah 4 (Tanggal/Waktu):`, e); await ctx.reply('Terjadi kesalahan.'); return ctx.scene.leave(); }
        return ctx.scene.leave(); 
    }
);

scheduleScene.command('batalscene', async (ctx) => {
    logger.info(`[SCENE: ${SCHEDULE_WIZARD_SCENE_ID}] Perintah /batalscene diterima. User: ${ctx.from.id}`);
    await ctx.reply('Penjadwalan dibatalkan.');
    return ctx.scene.leave();
});

module.exports = scheduleScene;