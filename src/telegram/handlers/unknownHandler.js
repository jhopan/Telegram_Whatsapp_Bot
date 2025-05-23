// src/telegram/handlers/unknownHandler.js
const logger = require('../../utils/logger');

function createUnknownHandler(checkGroupMembership, sendJoinGroupRequest) {
    
    return async (ctx) => {
        logger.info('[unknownHandler] Handler dipicu.'); // <-- LOG BARU 1

        if (!ctx.message) {
            logger.info('[unknownHandler] Update bukan pesan, diabaikan.');
            return;
        }

        logger.info('[unknownHandler] Tipe Pesan:', ctx.updateSubTypes); // <-- LOG BARU 2 (Lebih Akurat)
        logger.info('[unknownHandler] Kunci Pesan:', Object.keys(ctx.message)); // <-- LOG BARU 3

        let messageDescription = 'Pesan Tidak Dikenal';
        let shouldProcess = false;

        if (ctx.message.text) {
            messageDescription = `Teks "${ctx.message.text}"`;
            shouldProcess = true;
        } else if (ctx.message.sticker) {
            messageDescription = 'Sticker';
            shouldProcess = true;
        } else if (ctx.message.photo) {
            messageDescription = 'Foto';
            shouldProcess = true;
        }

        if (!shouldProcess) {
            logger.info(`[unknownHandler] Tipe pesan tidak ditargetkan (${ctx.updateSubTypes.join(', ')}), diabaikan.`);
            return;
        }

        logger.info(`[unknownHandler] Memproses: ${messageDescription}`); // <-- LOG BARU 4

        // 3. Cek scene
        if (ctx.scene && ctx.scene.current) {
            logger.info(`[unknownHandler] Sedang dalam scene ${ctx.scene.current.id}. Diabaikan.`);
            return;
        }

        logger.info('[unknownHandler] Tidak dalam scene, melanjutkan cek keanggotaan.'); // <-- LOG BARU 5

        // 4. Cek Keanggotaan Grup
        const isMember = await checkGroupMembership(ctx);
        if (!isMember) {
            logger.info('[unknownHandler] Bukan anggota, mengirim permintaan join.'); // <-- LOG BARU 6
            await sendJoinGroupRequest(ctx, 'Untuk menggunakan bot, ');
            return;
        }

        logger.info('[unknownHandler] Anggota grup, mengirim balasan "tidak dikenal".'); // <-- LOG BARU 7

        // 5. Kirim balasan "Tidak Dikenal"
        logger.warn(`[unknownHandler] Menerima ${messageDescription} yang tidak dikenal dari ${ctx.from.username || ctx.from.id}`);
        await ctx.reply(
            'Mohon maaf, perintah atau pesan tersebut tidak dikenali.\n\n' +
            'Silakan gunakan /start untuk menampilkan menu utama atau /help untuk bantuan.'
        );
    };
}

module.exports = createUnknownHandler;