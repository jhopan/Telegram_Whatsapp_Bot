// src/telegram/index.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const config = require('../config');
const logger = require('../utils/logger');

// Impor scenes
const scheduleScene = require('./scenes/scheduleScene'); 
const cancelScene = require('./scenes/cancelScene'); 

// Impor handlers
const { helpMessage } = require('./handlers/startHandler'); 
const loginHandler = require('./handlers/loginHandler');
const listScheduledHandler = require('./handlers/listScheduledHandler');
// const cancelScheduledHandler = require('./handlers/cancelScheduledHandler'); // Digantikan oleh scene
const logoutHandler = require('./handlers/logoutHandler'); 
const { isReady } = require('../whatsapp/client'); 

// --- Konfigurasi Grup Wajib ---
// GANTI DENGAN ID GRUP TELEGRAM ANDA YANG SEBENARNYA (biasanya negatif untuk grup/supergrup)
const TARGET_GROUP_ID = -1002608347193; // <--- NILAI INI SUDAH DIGANTI SESUAI SCREENSHOT ANDA
const TARGET_GROUP_INVITE_LINK = 'https://t.me/+9sPvJmTqZU8yZDZl'; // Link yang Anda berikan
const MINIMUM_MEMBER_STATUS = ['member', 'administrator', 'creator']; // Status yang dianggap sudah join

if (!config.telegramBotToken) {
    logger.error('Token Bot Telegram tidak ditemukan! Atur TELEGRAM_BOT_TOKEN di file .env');
    process.exit(1);
}
// Anda bisa menghapus atau menyesuaikan pengecekan placeholder ini sekarang karena ID sudah diisi
// if (TARGET_GROUP_ID === -1001234567890 && TARGET_GROUP_INVITE_LINK === 'https://t.me/your_group_invite_link') {
//     logger.warn('PERHATIAN: TARGET_GROUP_ID dan TARGET_GROUP_INVITE_LINK belum diatur dengan benar di src/telegram/index.js! Fitur force join mungkin tidak berfungsi.');
// } else if (TARGET_GROUP_ID === -1001234567890) {
//    logger.warn('PERHATIAN: TARGET_GROUP_ID masih menggunakan nilai placeholder. Fitur force join mungkin tidak berfungsi dengan benar.');
// }


const bot = new Telegraf(config.telegramBotToken);
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

// Fungsi untuk mengecek keanggotaan grup
async function checkGroupMembership(ctx) {
    // Hapus pengecekan placeholder karena ID sudah diisi
    // if (!TARGET_GROUP_ID || TARGET_GROUP_ID === -1001234567890) { 
    //     logger.warn('Pengecekan keanggotaan grup dilewati karena TARGET_GROUP_ID belum diisi dengan benar.');
    //     return false; 
    // }
    if (!TARGET_GROUP_ID) { // Cek jika TARGET_GROUP_ID null atau undefined
        logger.error('TARGET_GROUP_ID tidak terdefinisi atau null. Pengecekan keanggotaan tidak bisa dilakukan.');
        return false; // Anggap tidak join jika ID tidak ada
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

// Fungsi untuk mengirim pesan permintaan join grup
async function sendJoinGroupRequest(ctx, customMessage = '') {
    const message = `${customMessage}Anda harus bergabung dengan grup kami terlebih dahulu untuk menggunakan bot ini.\n\nSilakan bergabung melalui link di bawah ini, lalu klik tombol "Saya Sudah Bergabung".`;
    await ctx.reply(message, Markup.inlineKeyboard([
        [Markup.button.url('🔗 Gabung Grup Kami', TARGET_GROUP_INVITE_LINK)],
        [Markup.button.callback('✅ Saya Sudah Bergabung / Cek Ulang', 'action_check_membership')]
    ]));
}

// Fungsi untuk menampilkan menu utama inline
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

// Fungsi untuk mengirim pesan bantuan utama
const sendHelpMessage = async (ctx) => {
    const isMember = await checkGroupMembership(ctx);
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
    await sendMainMenu(ctx, menuGreeting);
};


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

// Handler untuk tombol "Saya Sudah Bergabung / Cek Ulang"
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


bot.action('action_help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await sendHelpMessage(ctx);
    } catch (error) {
        logger.error('Error di action_help:', error);
        await ctx.reply('Gagal menampilkan bantuan.');
    }
});

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

bot.command('daftarterjadwal', async (ctx) => {
    const isMember = await checkGroupMembership(ctx);
    if (!isMember) { return sendJoinGroupRequest(ctx); }
    await listScheduledHandler(ctx);
});
bot.command('batalkan', async (ctx) => {
    const isMember = await checkGroupMembership(ctx);
    if (!isMember) { return sendJoinGroupRequest(ctx); }

    if (ctx.scene && ctx.scene.current) { 
        logger.info('/batalkan diterima saat dalam scene, mungkin pengguna ingin /batalscene');
        return ctx.reply('Jika ingin membatalkan proses saat ini, kirim /batalscene. Jika ingin membatalkan jadwal yang sudah ada, gunakan tombol "Batalkan Jadwal" dari menu /start.');
    }
    logger.info('Perintah /batalkan diterima, masuk ke cancelWizard scene.');
    await ctx.scene.enter(cancelScene.id); 
});


const commands = require('./commands'); 
const relevantCommands = commands.filter(cmd => ![
    'login_wa', 'logout_wa', 'jadwalkanpesan', 'start'
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
