// src/utils/logger.js
const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, '../../app.log'); // Simpan log di root folder

function log(level, message, errorObject = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (errorObject) {
        // Jika ada objek error, tambahkan detailnya.
        // Coba ambil stack trace jika ada, atau konversi error menjadi string.
        const errorDetails = errorObject.stack || errorObject.toString();
        logMessage += `\n--- Error Details ---\n${errorDetails}\n--- End Error Details ---`;
    }
    logMessage += '\n'; // Tambahkan baris baru di akhir setiap entri log

    // Tampilkan juga di konsol
    if (errorObject && level.toLowerCase() === 'error') {
        console.error(logMessage.trim()); // Untuk error, gunakan console.error
    } else {
        console.log(logMessage.trim());
    }
    
    // Simpan ke file
    try {
        fs.appendFileSync(logFilePath, logMessage);
    } catch (e) {
        console.error("!!! CRITICAL: Failed to write to log file !!!", e);
        console.error("Original log message was:", logMessage.trim());
    }
}

module.exports = {
    info: (message) => log('info', message),
    warn: (message) => log('warn', message),
    // Modifikasi logger.error untuk bisa menerima argumen kedua (objek error)
    error: (message, errorObject = null) => log('error', message, errorObject),
};
