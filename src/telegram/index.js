// src/telegram/index.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const config = require('../config');
const logger = require('../utils/logger');

// Impor scenes
const scheduleScene = require('./scenes/scheduleScene'); // Ini adalah instance WizardScene

// Impor handlers
const { helpMessage } = require('./handlers/startHandler'); 
const loginHandler = require('./handlers/loginHandler');
const listScheduledHandler = require('./handlers/listScheduledHandler');
const cancelScheduledHandler = require('./handlers/cancelScheduledHandler');
const logoutHandler = require('./handlers/logoutHandler'); 
const { isReady } = require('../whatsapp/client'); 

if (!config.telegramBotToken) {
    logger.error('Token Bot Telegram tidak ditemukan! Atur TELEGRAM_BOT_TOKEN di file .env');
    process.exit(1);
}

const bot = new Telegraf(config.telegramBotToken);

// Membuat Stage untuk Scenes
// scheduleScene.id akan mengambil ID yang didefinisikan saat scene dibuat ('scheduleWizard')
const stage = new Scenes.Stage([scheduleScene], { default: null }); 

logger.info('Scenes yang terdaftar di stage:', stage.scenes.keys()); // Log untuk melihat scene yang terdaftar

// Middleware untuk session (harus sebelum stage)
bot.use(session());
// Middleware untuk Stage (Scenes)
bot.use(stage.middleware());

// Middleware untuk logging setiap update
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
            [Markup.button.callback('🗓️ Jadwalkan Pesan', 'action_schedule_message')],
            [Markup.button.callback('📋 Daftar Jadwal', 'action_list_scheduled'), Markup.button.callback('❌ Batalkan Jadwal', 'action_cancel_info')],
            [Markup.button.callback('🚪 Logout WhatsApp', 'action_logout_wa')],
            [Markup.button.callback('❓ Bantuan', 'action_help')]
        ]);
    } else {
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔒 Login WhatsApp', 'action_login_wa')],
            [Markup.button.callback('❓ Bantuan', 'action_help')]
        ]);
    }
    await ctx.reply(greetingMessage, keyboard);
};

// Handler untuk perintah /start
bot.start(async (ctx) => {
    try {
        // Jika pengguna sedang dalam scene, keluar dulu
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

// Handler untuk tombol Bantuan
bot.action('action_help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply(helpMessage); 
    } catch (error) {
        logger.error('Error di action_help:', error);
        await ctx.reply('Gagal menampilkan bantuan.');
    }
});

// Handler untuk tombol Login WhatsApp
bot.action('action_login_wa', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await loginHandler(ctx); 
    } catch (error) {
        logger.error('Error di action_login_wa:', error);
        await ctx.reply('Gagal memproses login.');
    }
});

// Handler untuk tombol Logout WhatsApp
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

// Handler untuk tombol Jadwalkan Pesan -> Masuk ke Scene
bot.action('action_schedule_message', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        if (!isReady()) {
            await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu sebelum menjadwalkan pesan.');
            await sendMainMenu(ctx, 'Silakan login terlebih dahulu:'); 
            return;
        }
        // Gunakan ID scene yang sama dengan yang didefinisikan di scheduleScene.js
        logger.info(`Mencoba masuk ke scene: ${scheduleScene.id}`); // Log ID scene yang akan dimasuki
        await ctx.scene.enter(scheduleScene.id); // Ini seharusnya 'scheduleWizard'
    } catch (error) {
        logger.error('Error saat masuk ke scheduleWizard scene:', error);
        await ctx.reply('Maaf, terjadi kesalahan saat memulai penjadwalan.');
    }
});

// Handler untuk tombol Daftar Terjadwal
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

// Handler untuk tombol Batalkan Jadwal (memberi info dulu)
bot.action('action_cancel_info', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        if (!isReady()) {
            await ctx.reply('⚠️ Anda harus login ke WhatsApp terlebih dahulu.');
            await sendMainMenu(ctx, 'Silakan login terlebih dahulu:');
            return;
        }
        await ctx.reply('Untuk membatalkan jadwal, silakan kirim perintah:\n/batalkan <ID_Pesan_Terjadwal>\nAnda bisa mendapatkan ID Pesan dari menu "Daftar Jadwal".');
    } catch (error) {
        logger.error('Error di action_cancel_info:', error);
        await ctx.reply('Gagal menampilkan info pembatalan.');
    }
});


// Perintah lama yang mungkin masih relevan atau untuk akses cepat
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
bot.command('batalkan', cancelScheduledHandler); 


// Mengatur perintah bot di Telegram agar muncul di menu
const commands = require('./commands'); 
const relevantCommands = commands.filter(cmd => ![
    'login_wa', 
    'logout_wa', 
    'jadwalkanpesan', 
    'daftarterjadwal', 
].includes(cmd.command)); 
bot.telegram.setMyCommands(relevantCommands).then(() => {
    logger.info('Perintah bot berhasil diatur di Telegram (menu).');
}).catch(err => {
    logger.error('Gagal mengatur perintah bot di Telegram (menu):', err);
});


// Penanganan error global Telegraf
bot.catch((err, ctx) => {
    logger.error(`Error pada Telegraf untuk ${ctx.updateType} dari user ${ctx.from.id}`, err);
    if (ctx.scene && ctx.scene.current) { // Jika error terjadi di dalam scene, coba tinggalkan scene
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
