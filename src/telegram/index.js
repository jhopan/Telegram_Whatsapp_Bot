// src/telegram/index.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const config = require('../config');
const logger = require('../utils/logger');

// Impor scenes
const scheduleScene = require('./scenes/scheduleScene'); 
const cancelScene = require('./scenes/cancelScene'); // <-- Impor scene baru

// Impor handlers
// Gunakan helpMessage dari startHandler.js jika logika start utama ada di sini
const { helpMessage } = require('./handlers/startHandler'); 
const loginHandler = require('./handlers/loginHandler');
const listScheduledHandler = require('./handlers/listScheduledHandler');
// const cancelScheduledHandler = require('./handlers/cancelScheduledHandler'); // Digantikan oleh scene
const logoutHandler = require('./handlers/logoutHandler'); 
const { isReady } = require('../whatsapp/client'); 

if (!config.telegramBotToken) {
    logger.error('Token Bot Telegram tidak ditemukan! Atur TELEGRAM_BOT_TOKEN di file .env');
    process.exit(1);
}

const bot = new Telegraf(config.telegramBotToken);
// Daftarkan semua scene ke Stage
const stage = new Scenes.Stage([scheduleScene, cancelScene], { default: null }); 

logger.info('Scenes yang terdaftar di stage:', Array.from(stage.scenes.keys())); 

bot.use(session());
bot.use(stage.middleware());

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

// Fungsi untuk menampilkan menu utama inline
const sendMainMenu = async (ctx, greetingMessage) => {
    const loggedIn = isReady();
    let keyboard;
    if (loggedIn) {
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('👤 Kirim ke Pribadi', 'action_schedule_personal')],
            [Markup.button.callback('👥 Kirim ke Grup', 'action_schedule_group')],
            [Markup.button.callback('🗓️ Daftar Jadwal Saya', 'action_list_scheduled')],
            [Markup.button.callback('❌ Batalkan Jadwal', 'action_enter_cancel_scene')], // <-- Callback diubah
            [Markup.button.callback('🚪 Logout WhatsApp', 'action_logout_wa')],
            [Markup.button.callback('❓ Bantuan', 'action_help')]
        ]);
    } else {
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔒 Login WhatsApp', 'action_login_wa')],
            [Markup.button.callback('❓ Bantuan', 'action_help')]
        ]);
    }
    
    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(greetingMessage, keyboard).catch(async (e) => {
                logger.warn('Gagal mengedit pesan menu, mengirim pesan baru.', e.message);
                await ctx.reply(greetingMessage, keyboard);
            });
        } catch (e) {
            logger.warn('Gagal mengedit pesan atau mengirim pesan baru setelah callback, mencoba reply biasa', e);
            await ctx.reply(greetingMessage, keyboard); 
        }
    } else {
        await ctx.reply(greetingMessage, keyboard);
    }
};

bot.start(async (ctx) => {
    try {
        if (ctx.scene && ctx.scene.current) {
            logger.info(`Perintah /start diterima saat dalam scene ${ctx.scene.current.id}. Meninggalkan scene.`);
            await ctx.scene.leave();
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

bot.action('action_help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply(helpMessage, Markup.removeKeyboard()); 
        const firstName = ctx.from.first_name || ctx.session.username || 'Pengguna';
        await sendMainMenu(ctx, `Ada lagi yang bisa dibantu, ${firstName}?`);
    } catch (error) {
        logger.error('Error di action_help:', error);
        await ctx.reply('Gagal menampilkan bantuan.');
    }
});

bot.action('action_login_wa', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await loginHandler(ctx); 
    } catch (error) {
        logger.error('Error di action_login_wa:', error);
        await ctx.reply('Gagal memproses login.');
    }
});

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

const enterScheduleScene = async (ctx, targetType) => {
    if (!isReady()) {
        await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu sebelum menjadwalkan pesan.');
        await sendMainMenu(ctx, 'Silakan login terlebih dahulu:'); 
        return;
    }
    ctx.session.scheduleTargetType = targetType; 
    logger.info(`Mencoba masuk ke scene: ${scheduleScene.id} dengan targetType: ${targetType}`);
    await ctx.scene.enter(scheduleScene.id);
};

bot.action('action_schedule_personal', async (ctx) => {
    try {
        await ctx.answerCbQuery('Memulai penjadwalan pesan pribadi...');
        await enterScheduleScene(ctx, 'personal');
    } catch (error) {
        logger.error('Error di action_schedule_personal:', error);
        await ctx.reply('Maaf, terjadi kesalahan saat memulai penjadwalan pesan pribadi.');
    }
});

bot.action('action_schedule_group', async (ctx) => {
    try {
        await ctx.answerCbQuery('Memulai penjadwalan pesan grup...');
        await enterScheduleScene(ctx, 'group');
    } catch (error) {
        logger.error('Error di action_schedule_group:', error);
        await ctx.reply('Maaf, terjadi kesalahan saat memulai penjadwalan pesan grup.');
    }
});


bot.action('action_list_scheduled', async (ctx) => {
    try {
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

// Handler untuk tombol "Batalkan Jadwal" yang baru -> Masuk ke cancelScene
bot.action('action_enter_cancel_scene', async (ctx) => { 
    try {
        await ctx.answerCbQuery('Memulai proses pembatalan jadwal...');
        if (!isReady()) {
            await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu.');
            await sendMainMenu(ctx, 'Silakan login terlebih dahulu:');
            return;
        }
        // Pastikan CANCEL_WIZARD_SCENE_ID didefinisikan di cancelScene.js dan cancelScene.id mengembalikannya
        await ctx.scene.enter(cancelScene.id); 
    } catch (error) {
        logger.error('Error di action_enter_cancel_scene:', error);
        await ctx.reply('Gagal memulai proses pembatalan jadwal.');
    }
});


bot.help(async (ctx) => { 
    try {
        if (ctx.scene && ctx.scene.current) {
            logger.info(`Perintah /help diterima saat dalam scene ${ctx.scene.current.id}. Meninggalkan scene.`);
            await ctx.scene.leave();
        }
        const firstName = ctx.from.first_name || ctx.session.username || 'Pengguna';
        let greeting = `Hai ${firstName}! Ini adalah menu bantuan.`;
        if (isReady()) {
            greeting += ` Anda sudah login ke WhatsApp.`;
        } else {
            greeting += ` Anda belum login ke WhatsApp.`;
        }
        await sendMainMenu(ctx, greeting);
    } catch (error) {
        logger.error('Error di /help handler:', error);
    }
});

bot.command('daftarterjadwal', listScheduledHandler);

// Perintah /batalkan sekarang juga bisa masuk ke scene
bot.command('batalkan', async (ctx) => {
    if (ctx.scene && ctx.scene.current) { 
        logger.info('/batalkan diterima saat dalam scene, mungkin pengguna ingin /batalscene');
        return ctx.reply('Jika ingin membatalkan proses saat ini, kirim /batalscene. Jika ingin membatalkan jadwal yang sudah ada, gunakan tombol "Batalkan Jadwal" dari menu /start.');
    }
    logger.info('Perintah /batalkan diterima, masuk ke cancelWizard scene.');
    // Pastikan CANCEL_WIZARD_SCENE_ID didefinisikan di cancelScene.js dan cancelScene.id mengembalikannya
    await ctx.scene.enter(cancelScene.id); 
});


const commands = require('./commands'); 
const relevantCommands = commands.filter(cmd => ![
    'login_wa', 
    'logout_wa', 
    'jadwalkanpesan', 
    'daftarterjadwal', 
    'start',
    'batalkan' // Dihapus dari menu command jika sudah ada tombol
].includes(cmd.command)); 
bot.telegram.setMyCommands(relevantCommands).then(() => {
    logger.info('Perintah bot berhasil diatur di Telegram (menu).');
}).catch(err => {
    logger.error('Gagal mengatur perintah bot di Telegram (menu):', err);
});

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
