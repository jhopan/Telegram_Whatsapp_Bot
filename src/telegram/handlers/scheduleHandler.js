// src/telegram/handlers/scheduleHandler.js
const storageService = require('../../services/storageService');
const logger = require('../../utils/logger');

// Fungsi untuk parse tanggal dan waktu
// Format yang diharapkan: HH:MM DD/MM/YYYY
function parseDateTime(timeStr, dateStr) {
    const cleanTimeStr = timeStr.replace(/[^\d:]/g, '');
    const cleanDateStr = dateStr.replace(/[^\d/]/g, '');

    const timeParts = cleanTimeStr.match(/^(\d{1,2}):(\d{1,2})$/);
    const dateParts = cleanDateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (!timeParts || !dateParts) {
        logger.warn(`Format waktu (${cleanTimeStr}) atau tanggal (${cleanDateStr}) tidak valid saat regex matching.`);
        return null;
    }

    const day = parseInt(dateParts[1], 10);
    const monthInput = parseInt(dateParts[2], 10); // Bulan dari input (1-12)
    const year = parseInt(dateParts[3], 10);
    const hour = parseInt(timeParts[1], 10);
    const minute = parseInt(timeParts[2], 10);

    // Log nilai yang diparsing sebelum validasi lebih lanjut
    logger.info(`Parsing dateTime: day=${day}, monthInput=${monthInput}, year=${year}, hour=${hour}, minute=${minute}`);

    if (isNaN(day) || isNaN(monthInput) || isNaN(year) || isNaN(hour) || isNaN(minute)) {
        logger.warn('Salah satu komponen tanggal/waktu bukan angka setelah parseInt.');
        return null;
    }
    
    const month = monthInput - 1; // Konversi ke bulan 0-indexed untuk JavaScript Date

    // Validasi dasar rentang (bisa lebih detail)
    if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || year < 1970 || year > 3000) { // Tambahkan validasi tahun
        logger.warn(`Salah satu komponen tanggal/waktu di luar rentang valid: year=${year}, month(0-idx)=${month}, day=${day}, hour=${hour}, minute=${minute}`);
        return null;
    }

    const generatedDate = new Date(year, month, day, hour, minute, 0);
    // Periksa apakah tanggal yang dihasilkan valid dengan memeriksa getTime()
    if (isNaN(generatedDate.getTime())) {
        logger.error(`new Date(${year}, ${month}, ${day}, ${hour}, ${minute}, 0) menghasilkan tanggal yang tidak valid (getTime() is NaN).`);
        return null;
    }
    // Periksa apakah komponen tanggal pada objek Date sesuai dengan input (untuk menghindari rollover bulan/hari yang tidak diinginkan)
    if (generatedDate.getFullYear() !== year || generatedDate.getMonth() !== month || generatedDate.getDate() !== day) {
        logger.error(`Date object rolled over or invalid for input: year=${year}, month(0-idx)=${month}, day=${day}. Generated: ${generatedDate.toString()}`);
        return null;
    }


    logger.info(`parseDateTime menghasilkan: ${generatedDate.toString()}`);
    return generatedDate;
}

module.exports = async (ctx) => {
    try {
        logger.info(`Menerima pesan untuk dijadwalkan: ${ctx.message.text}`);
        const cleanText = ctx.message.text.replace(/[<>]/g, '');
        const parts = cleanText.split(' '); 

        if (parts.length < 5) {
            logger.warn(`Format /jadwalkanpesan salah dari user ${ctx.from.id}. Input: ${ctx.message.text}`);
            return ctx.reply('Format salah. Gunakan: /jadwalkanpesan <nomor_WA_atau_ID_grup> <HH:MM> <DD/MM/YYYY> <isi_pesan>\nContoh: /jadwalkanpesan 081234567890 17:00 25/12/2025 Selamat Natal!');
        }

        const command = parts.shift(); 
        const target = parts.shift();   
        const timeStr = parts.shift();  
        const dateStr = parts.shift();  
        const text = parts.join(' ');   

        if (!target || !timeStr || !dateStr || !text) {
            logger.warn(`Parsing /jadwalkanpesan menghasilkan nilai null untuk salah satu field. Input: ${ctx.message.text}`);
            return ctx.reply('Format salah. Pastikan semua bagian (nomor, waktu, tanggal, pesan) terisi.\nGunakan: /jadwalkanpesan <nomor_WA_atau_ID_grup> <HH:MM> <DD/MM/YYYY> <isi_pesan>');
        }
        
        logger.info(`Parsing jadwal: Target=${target}, Waktu=${timeStr}, Tanggal=${dateStr}, Pesan=${text}`);

        const dateTime = parseDateTime(timeStr, dateStr);

        if (!dateTime) { // Ini sekarang juga menangkap jika getTime() adalah NaN dari parseDateTime
            logger.warn(`Parsing tanggal/waktu gagal atau menghasilkan tanggal tidak valid untuk input: ${timeStr} ${dateStr}`);
            return ctx.reply(`Format tanggal atau waktu salah, atau tanggal tidak valid. Gunakan HH:MM untuk waktu dan DD/MM/YYYY untuk tanggal.\nContoh waktu: 17:00\nContoh tanggal: 25/12/2025`);
        }
        
        // Log tambahan untuk memeriksa objek dateTime sebelum digunakan lebih lanjut
        logger.info(`Objek dateTime yang akan digunakan: ${dateTime.toString()}, getTime(): ${dateTime.getTime()}`);

        const now = new Date();
        const oneMinuteLater = new Date(now.getTime() + 60000); 

        if (dateTime <= oneMinuteLater) {
            logger.warn(`Waktu penjadwalan sudah lewat atau terlalu dekat: ${dateTime.toString()} (ISO: ${dateTime.toISOString()})`);
            return ctx.reply('Tanggal dan waktu penjadwalan harus di masa depan (minimal lebih dari 1 menit dari sekarang).');
        }

        const schedule = {
            target,
            dateTime: dateTime.toISOString(), // Error terjadi di sini sebelumnya
            text,
            userId: ctx.from.id,
            sent: false,
        };

        const savedSchedule = storageService.addScheduledMessage(schedule);
        logger.info(`Pesan dijadwalkan oleh ${ctx.from.username || ctx.from.id} untuk ${target} pada ${dateTime.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} dengan ID: ${savedSchedule.id}`);
        
        const userFriendlyDateTime = dateTime.toLocaleString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar'
        });
        ctx.reply(`✅ Pesan untuk "${target}" berhasil dijadwalkan pada ${userFriendlyDateTime} (ID: ${savedSchedule.id})`);

    } catch (error) {
        logger.error('Error tidak tertangani di scheduleHandler:', error); // Menggunakan logger yang sudah diperbaiki
        // console.error sudah ada di logger.js sekarang
        ctx.reply('Maaf, terjadi kesalahan saat memproses permintaan penjadwalan Anda. Silakan coba lagi atau hubungi admin jika masalah berlanjut.').catch(e => logger.error('Gagal mengirim pesan error dari scheduleHandler ke user', e));
    }
};
