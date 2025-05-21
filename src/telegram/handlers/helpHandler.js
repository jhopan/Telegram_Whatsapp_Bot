// src/telegram/handlers/helpHandler.js
const startHandler = require('./startHandler'); // Menggunakan pesan yang sama

module.exports = (ctx) => {
    startHandler(ctx); // Memanggil logika yang sama dengan start
};