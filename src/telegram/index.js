// src/telegram/index.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const config = require('../config');
const logger = require('../utils/logger');

// Impor scenes
// const scheduleScene = require('./scenes/scheduleScene'); // <-- DINONAKTIFKAN
const personalScheduleScene = require('./scenes/personalScheduleScene'); // Impor scene pribadi
const groupScheduleScene = require('./scenes/groupScheduleScene');    // Impor scene grup
const cancelScene = require('./scenes/cancelScene'); 

// Impor handlers
const { helpMessage } = require('./handlers/startHandler'); 
const loginHandler = require('./handlers/loginHandler');
const listScheduledHandler = require('./handlers/listScheduledHandler');
const createUnknownHandler = require('./handlers/unknownHandler');
const logoutHandler = require('./handlers/logoutHandler'); 
const { isReady } = require('../whatsapp/client'); 

// --- Konfigurasi Grup Wajib ---
const TARGET_GROUP_ID = -1002608347193; 
const TARGET_GROUP_INVITE_LINK = 'https://t.me/+9sPvJmTqZU8yZDZl'; 
const MINIMUM_MEMBER_STATUS = ['member', 'administrator', 'creator']; 

if (!config.telegramBotToken) {
    logger.error('Token Bot Telegram tidak ditemukan! Atur TELEGRAM_BOT_TOKEN di file .env');
    process.exit(1);
}

const bot = new Telegraf(config.telegramBotToken);
// --- UBAH STAGE ---
// Daftarkan scene baru (personal & group) dan hapus yang lama
const stage = new Scenes.Stage(
    [personalScheduleScene, groupScheduleScene, cancelScene], 
    { default: null }
); 

logger.info('Scenes yang terdaftar di stage:', Array.from(stage.scenes.keys())); 

bot.use(session());
bot.use(stage.middleware());

// Middleware Logging (Tetap Sama)
bot.use(async (ctx, next) => {
    const updateType = ctx.updateType;
    let messageContent = '';
    if (updateType === 'message' && ctx.message && ctx.message.text) {
        messageContent = `"${ctx.message.text}"`;
    } else if (updateType === 'callback_query' && ctx.callbackQuery && ctx.callbackQuery.data) {
        messageContent = `Callback Query: "${ctx.callbackQuery.data}"`;
    } else {
        messageContent = `(${updateType})`;
    }
    logger.info(`Menerima ${messageContent} dari ${ctx.from.username || ctx.from.id} (Chat ID: ${ctx.chat.id})`);
    
    if (ctx.from && ctx.from.id) {
        ctx.session.userId = ctx.from.id; 
        ctx.session.username = ctx.from.username || ctx.from.first_name || 'Pengguna';
    }
    await next(); 
});

// Fungsi checkGroupMembership (Tetap Sama)
async function checkGroupMembership(ctx) {
    if (!TARGET_GROUP_ID) {
        logger.error('TARGET_GROUP_ID tidak terdefinisi atau null. Pengecekan keanggotaan tidak bisa dilakukan.');
        return false;
    }
    try {
        const member = await ctx.telegram.getChatMember(TARGET_GROUP_ID, ctx.from.id);
        logger.info(`Status keanggotaan user ${ctx.from.id} di grup ${TARGET_GROUP_ID}: ${member.status}`);
        return MINIMUM_MEMBER_STATUS.includes(member.status);
    } catch (error) {
        logger.error(`Error saat mengecek keanggotaan grup untuk user ${ctx.from.id} di grup ${TARGET_GROUP_ID}: ${error.message}`);
        if (error.message.includes('chat not found') || error.message.includes('user not found')) {
            logger.warn(`Grup dengan ID ${TARGET_GROUP_ID} tidak ditemukan atau user ${ctx.from.id} tidak ditemukan di sana.`);
        } else if (error.message.includes('bot is not a member of the chat')) {
            logger.error(`PENTING: Bot tidak menjadi anggota grup target (${TARGET_GROUP_ID}). Bot tidak bisa mengecek keanggotaan pengguna.`);
        }
        return false;
    }
}

// Fungsi sendJoinGroupRequest (Tetap Sama)
async function sendJoinGroupRequest(ctx, customMessage = '') {
    const message = `${customMessage}Anda harus bergabung dengan grup kami terlebih dahulu untuk menggunakan bot ini.\n\nSilakan bergabung melalui link di bawah ini, lalu klik tombol "Saya Sudah Bergabung".`;
    await ctx.reply(message, Markup.inlineKeyboard([
        [Markup.button.url('🔗 Gabung Grup Kami', TARGET_GROUP_INVITE_LINK)],
        [Markup.button.callback('✅ Saya Sudah Bergabung / Cek Ulang', 'action_check_membership')]
    ]));
}

// Fungsi sendMainMenu (Tetap Sama)
const sendMainMenu = async (ctx, greetingMessage) => {
    const loggedInToWhatsApp = isReady(); 
    let keyboard;
    if (loggedInToWhatsApp) {
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('👤 Kirim ke Pribadi', 'action_schedule_personal')],
            [Markup.button.callback('👥 Kirim ke Grup', 'action_schedule_group')],
            [Markup.button.callback('🗓️ Daftar Jadwal Saya', 'action_list_scheduled')],
            [Markup.button.callback('❌ Batalkan Jadwal', 'action_enter_cancel_scene')], 
            [Markup.button.callback('🚪 Logout WhatsApp', 'action_logout_wa')],
            [Markup.button.callback('❓ Bantuan & Kontak', 'action_help')]
        ]);
    } else {
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔒 Login WhatsApp', 'action_login_wa')],
            [Markup.button.callback('❓ Bantuan & Kontak', 'action_help')]
        ]);
    }
    
    const messageOptions = { ...keyboard, parse_mode: 'Markdown' };

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(greetingMessage, messageOptions).catch(async (e) => {
                logger.warn('Gagal mengedit pesan menu, mengirim pesan baru.', e.message);
                await ctx.reply(greetingMessage, messageOptions);
            });
        } catch (e) {
            logger.warn('Gagal mengedit pesan atau mengirim pesan baru setelah callback, mencoba reply biasa', e);
            await ctx.reply(greetingMessage, messageOptions); 
        }
    } else {
        await ctx.reply(greetingMessage, messageOptions);
    }
};

// Fungsi sendHelpMessage (Tetap Sama)
const sendHelpMessage = async (ctx) => {
    const isMember = await checkGroupMembership(ctx); // <-- Aktifkan lagi jika perlu
    if (!isMember) {
        await sendJoinGroupRequest(ctx, 'Untuk mengakses bantuan dan fitur lainnya, ');
        return;
    }
    const initialHelpText = `Hai ${ctx.from.first_name || ctx.session.username || 'Pengguna'}!\n` + helpMessage; 
    await ctx.replyWithMarkdown(initialHelpText, Markup.removeKeyboard()); 
    let menuGreeting = 'Ada lagi yang bisa dibantu?';
    if (!isReady()){
        menuGreeting = 'Silakan login ke WhatsApp atau lihat bantuan di atas.';
    }
    await sendMainMenu(ctx, menuGreeting); // <-- Aktifkan lagi jika ingin menu muncul setelah /help
};


// bot.start (Tetap Sama)
bot.start(async (ctx) => {
    try {
        if (ctx.scene && ctx.scene.current) {
            logger.info(`Perintah /start diterima saat dalam scene ${ctx.scene.current.id}. Meninggalkan scene.`);
            await ctx.scene.leave();
        }

        const isMember = await checkGroupMembership(ctx);
        if (!isMember) {
            await sendJoinGroupRequest(ctx);
            return;
        }

        const firstName = ctx.from.first_name || ctx.session.username || 'Pengguna';
        let greeting = `Hai ${firstName}! `;
        if (isReady()) {
            greeting += `Selamat datang kembali di Bot Asisten WhatsApp Anda.`;
        } else {
            greeting += `Anda belum login ke WhatsApp. Silakan login terlebih dahulu.`;
        }
        await sendMainMenu(ctx, greeting);
    } catch (error) {
        logger.error('Error di /start handler:', error);
        await ctx.reply('Maaf, terjadi kesalahan saat menampilkan menu.');
    }
});

// bot.action('action_check_membership') (Tetap Sama)
bot.action('action_check_membership', async (ctx) => {
    try {
        await ctx.answerCbQuery('Memeriksa keanggotaan...');
        const isMember = await checkGroupMembership(ctx);
        if (isMember) {
            await ctx.deleteMessage().catch(e => logger.warn('Gagal menghapus pesan permintaan join', e)); 
            const firstName = ctx.from.first_name || ctx.session.username || 'Pengguna';
            let greeting = `Terima kasih telah bergabung, ${firstName}! `;
            if (isReady()) {
                greeting += `Selamat datang kembali di Bot Asisten WhatsApp Anda.`;
            } else {
                greeting += `Sekarang silakan login ke WhatsApp.`;
            }
            await sendMainMenu(ctx, greeting);
        } else {
            await ctx.reply('Anda masih belum terdeteksi sebagai anggota grup. Pastikan Anda sudah bergabung menggunakan link yang diberikan, lalu klik tombol "Saya Sudah Bergabung" lagi.');
        }
    } catch (error) {
        logger.error('Error di action_check_membership:', error);
        await ctx.reply('Terjadi kesalahan saat memeriksa keanggotaan.');
    }
});

// bot.action('action_help') (Tetap Sama)
bot.action('action_help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await sendHelpMessage(ctx);
    } catch (error) {
        logger.error('Error di action_help:', error);
        await ctx.reply('Gagal menampilkan bantuan.');
    }
});

// bot.action('action_login_wa') (Tetap Sama)
bot.action('action_login_wa', async (ctx) => {
    try {
        const isMember = await checkGroupMembership(ctx);
        if (!isMember) {
            await ctx.answerCbQuery('Anda harus bergabung dengan grup kami terlebih dahulu.');
            await sendJoinGroupRequest(ctx, 'Untuk login WhatsApp, ');
            return;
        }
        await ctx.answerCbQuery();
        await loginHandler(ctx); 
    } catch (error) {
        logger.error('Error di action_login_wa:', error);
        await ctx.reply('Gagal memproses login.');
    }
});

// bot.action('action_logout_wa') (Tetap Sama)
bot.action('action_logout_wa', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await logoutHandler(ctx); 
        await sendMainMenu(ctx, 'Anda telah logout. Silakan login kembali jika diperlukan.');
    } catch (error) {
        logger.error('Error di action_logout_wa:', error);
        await ctx.reply('Gagal memproses logout.');
    }
});

// --- UBAH FUNGSI INI ---
// Fungsi enterScheduleScene kini menerima sceneId
const enterScheduleScene = async (ctx, sceneId) => {
    const isMember = await checkGroupMembership(ctx);
    if (!isMember) {
        await sendJoinGroupRequest(ctx, 'Untuk menjadwalkan pesan, ');
        return;
    }
    if (!isReady()) {
        await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu sebelum menjadwalkan pesan.');
        await sendMainMenu(ctx, 'Silakan login terlebih dahulu:'); 
        return;
    }
    // Hapus setting ctx.session.scheduleTargetType 
    logger.info(`Mencoba masuk ke scene: ${sceneId}`);
    await ctx.scene.enter(sceneId); // Masuk ke scene berdasarkan ID
};

// --- UBAH ACTION INI ---
bot.action('action_schedule_personal', async (ctx) => {
    try {
        await ctx.answerCbQuery('Memulai penjadwalan pesan pribadi...');
        await enterScheduleScene(ctx, personalScheduleScene.id); // Panggil dengan ID scene pribadi
    } catch (error) {
        logger.error('Error di action_schedule_personal:', error);
        await ctx.reply('Maaf, terjadi kesalahan saat memulai penjadwalan pesan pribadi.');
    }
});

// --- UBAH ACTION INI ---
bot.action('action_schedule_group', async (ctx) => {
    try {
        await ctx.answerCbQuery('Memulai penjadwalan pesan grup...');
        await enterScheduleScene(ctx, groupScheduleScene.id); // Panggil dengan ID scene grup
    } catch (error) {
        logger.error('Error di action_schedule_group:', error);
        await ctx.reply('Maaf, terjadi kesalahan saat memulai penjadwalan pesan grup.');
    }
});

// bot.action('action_list_scheduled') (Tetap Sama)
bot.action('action_list_scheduled', async (ctx) => {
    try {
        const isMember = await checkGroupMembership(ctx);
        if (!isMember) {
            await ctx.answerCbQuery('Anda harus bergabung dengan grup kami terlebih dahulu.');
            await sendJoinGroupRequest(ctx, 'Untuk melihat daftar jadwal, ');
            return;
        }
        await ctx.answerCbQuery();
        if (!isReady()) {
            await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu.');
            await sendMainMenu(ctx, 'Silakan login terlebih dahulu:');
            return;
        }
        await listScheduledHandler(ctx); 
    } catch (error) {
        logger.error('Error di action_list_scheduled:', error);
        await ctx.reply('Gagal menampilkan daftar jadwal.');
    }
});

// bot.action('action_enter_cancel_scene') (Tetap Sama)
bot.action('action_enter_cancel_scene', async (ctx) => { 
    try {
        const isMember = await checkGroupMembership(ctx);
        if (!isMember) {
            await ctx.answerCbQuery('Anda harus bergabung dengan grup kami terlebih dahulu.');
            await sendJoinGroupRequest(ctx, 'Untuk membatalkan jadwal, ');
            return;
        }
        await ctx.answerCbQuery('Memulai proses pembatalan jadwal...');
        if (!isReady()) {
            await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu.');
            await sendMainMenu(ctx, 'Silakan login terlebih dahulu:');
            return;
        }
        await ctx.scene.enter(cancelScene.id); 
    } catch (error) {
        logger.error('Error di action_enter_cancel_scene:', error);
        await ctx.reply('Gagal memulai proses pembatalan jadwal.');
    }
});

// bot.help (Tetap Sama)
bot.help(async (ctx) => { 
    try {
        if (ctx.scene && ctx.scene.current) {
            logger.info(`Perintah /help diterima saat dalam scene ${ctx.scene.current.id}. Meninggalkan scene.`);
            await ctx.scene.leave();
        }
        await sendHelpMessage(ctx); 
    } catch (error) {
        logger.error('Error di /help handler:', error);
    }
});

// setMyCommands (Tetap Sama)
const commands = require('./commands'); 
const relevantCommands = commands.filter(cmd => 
    ['start', 'help'].includes(cmd.command)
); 
bot.telegram.setMyCommands(relevantCommands).then(() => {
    logger.info('Perintah bot berhasil diatur di Telegram (menu).');
}).catch(err => {
    logger.error('Gagal mengatur perintah bot di Telegram (menu):', err);
});

// unknownHandler (Tetap Sama, Pastikan Pendaftaran Benar)
const unknownHandler = createUnknownHandler(checkGroupMembership, sendJoinGroupRequest);
bot.on(['text', 'sticker', 'photo'], unknownHandler); // Pastikan ini benar (menggunakan array)

// bot.catch (Tetap Sama)
bot.catch((err, ctx) => {
    logger.error(`Error pada Telegraf untuk ${ctx.updateType} dari user ${ctx.from.id}`, err);
    if (ctx.scene && ctx.scene.current) { 
        logger.warn(`Error terjadi di dalam scene ${ctx.scene.current.id}. Mencoba meninggalkan scene.`);
        ctx.scene.leave().catch(e => logger.error('Gagal meninggalkan scene pada error global', e));
    }
    if (ctx.callbackQuery) {
        ctx.answerCbQuery('Terjadi kesalahan di server.').catch(e => logger.error('Gagal menjawab CBQ pada error global', e));
    }
    if (ctx.reply) {
        ctx.reply('Maaf, terjadi kesalahan internal. Silakan coba lagi nanti.').catch(e => logger.error('Gagal mengirim pesan error ke user setelah error global', e));
    } else {
        logger.error('ctx.reply tidak tersedia pada error global ini.');
    }
});

module.exports = bot;