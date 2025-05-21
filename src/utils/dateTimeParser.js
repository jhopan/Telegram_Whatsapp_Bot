// src/utils/dateTimeParser.js
const logger = require('./logger'); // Pastikan path ini benar, relatif terhadap dateTimeParser.js

/**
 * Mem-parse string waktu dan tanggal menjadi objek Date.
 * @param {string} timeStr String waktu dengan format HH:MM (contoh: "17:00").
 * @param {string} dateStr String tanggal dengan format DD/MM/YYYY (contoh: "25/12/2025").
 * @returns {Date|null} Objek Date jika valid, atau null jika tidak valid.
 */
function parseDateTime(timeStr, dateStr) {
    // Bersihkan input dari karakter yang tidak diinginkan (selain angka, :, /)
    const cleanTimeStr = typeof timeStr === 'string' ? timeStr.replace(/[^\d:]/g, '') : '';
    const cleanDateStr = typeof dateStr === 'string' ? dateStr.replace(/[^\d/]/g, '') : '';

    // Cocokkan dengan regex untuk format yang diharapkan
    const timeParts = cleanTimeStr.match(/^(\d{1,2}):(\d{1,2})$/);
    const dateParts = cleanDateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (!timeParts || !dateParts) {
        logger.warn(`[dateTimeParser] Format waktu ("${cleanTimeStr}") atau tanggal ("${cleanDateStr}") tidak valid saat regex matching.`);
        return null;
    }

    // Ambil komponen tanggal dan waktu
    const day = parseInt(dateParts[1], 10);
    const monthInput = parseInt(dateParts[2], 10); // Bulan dari input (1-12)
    const year = parseInt(dateParts[3], 10);
    const hour = parseInt(timeParts[1], 10);
    const minute = parseInt(timeParts[2], 10);

    logger.info(`[dateTimeParser] Parsing komponen: day=${day}, monthInput=${monthInput}, year=${year}, hour=${hour}, minute=${minute}`);

    // Validasi apakah semua komponen adalah angka setelah parsing
    if (isNaN(day) || isNaN(monthInput) || isNaN(year) || isNaN(hour) || isNaN(minute)) {
        logger.warn('[dateTimeParser] Salah satu komponen tanggal/waktu bukan angka setelah parseInt.');
        return null;
    }
    
    // Konversi bulan ke format 0-indexed untuk JavaScript Date (0 = Januari, 11 = Desember)
    const month = monthInput - 1;

    // Validasi rentang dasar untuk setiap komponen
    // Rentang tahun bisa disesuaikan jika perlu
    if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || year < 1970 || year > 3000) {
        logger.warn(`[dateTimeParser] Salah satu komponen tanggal/waktu di luar rentang valid: year=${year}, month(0-idx)=${month}, day=${day}, hour=${hour}, minute=${minute}`);
        return null;
    }

    // Buat objek Date
    const generatedDate = new Date(year, month, day, hour, minute, 0, 0); // Tambahkan 0 untuk detik dan milidetik

    // Periksa apakah tanggal yang dihasilkan valid dengan memeriksa getTime()
    if (isNaN(generatedDate.getTime())) {
        logger.error(`[dateTimeParser] new Date(${year}, ${month}, ${day}, ${hour}, ${minute}, 0, 0) menghasilkan tanggal yang tidak valid (getTime() is NaN).`);
        return null;
    }

    // Periksa apakah komponen tanggal pada objek Date yang dihasilkan sesuai dengan input
    // Ini untuk menangani kasus seperti input "31/02/2025" yang akan di-rollover oleh JavaScript Date menjadi tanggal di Maret.
    if (generatedDate.getFullYear() !== year || 
        generatedDate.getMonth() !== month || 
        generatedDate.getDate() !== day ||
        generatedDate.getHours() !== hour ||
        generatedDate.getMinutes() !== minute) {
        logger.error(`[dateTimeParser] Date object rolled over or did not match input components. Input: year=${year}, month(0-idx)=${month}, day=${day}, hour=${hour}, minute=${minute}. Generated: ${generatedDate.toString()}`);
        return null;
    }

    logger.info(`[dateTimeParser] parseDateTime berhasil menghasilkan: ${generatedDate.toString()}`);
    return generatedDate;
}

module.exports = { parseDateTime };
