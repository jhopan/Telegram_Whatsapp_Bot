// src/telegram/handlers/startHandler.js
const config = require('../../config'); // Impor config untuk mengambil nomor WA pemilik jika ada

// Nomor WhatsApp Pemilik/Admin untuk Bantuan
// Anda bisa juga menyimpannya di file .env dan mengambilnya via config
const ownerWhatsAppLink = config.ownerWhatsAppLink || 'https://api.whatsapp.com/send/?phone=6282298657242&text=Halo%2C+saya+butuh+bantuan+dengan+Bot+Asisten+WA.&type=phone_number&app_absent=0'; // Default ke nomor Anda

const helpMessage = `Selamat datang di Bot Asisten WhatsApp!

Bot ini digunakan untuk melakukan otomatis pengiriman pesan wa.
Baik untuk mengirim pribadi maupun ke grup.

Jika Anda memerlukan bantuan lebih lanjut atau menemukan masalah, jangan ragu untuk menghubungi pemilik bot melalui WhatsApp:
[Hubungi Pemilik Bot di WhatsApp](${ownerWhatsAppLink})
`;

module.exports = {
    helpMessage,
};
