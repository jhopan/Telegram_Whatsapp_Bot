// src/telegram/commands.js
const commands = [
    { command: 'start', description: 'Memulai bot dan menampilkan bantuan.' },
    { command: 'login_wa', description: 'Memulai proses login WhatsApp (scan QR).' },
    { command: 'logout_wa', description: 'Logout dari sesi WhatsApp dan hapus data sesi.' }, // <-- Tambahkan ini
    { command: 'jadwalkanpesan', description: 'Format: /jadwalkanpesan <nomor_WA/ID_grup> <HH:MM> <DD/MM/YYYY> <pesan>' },
    { command: 'daftarterjadwal', description: 'Melihat daftar pesan yang belum terkirim.' },
    { command: 'batalkan', description: 'Format: /batalkan <ID_pesan_terjadwal>' },
    { command: 'bantuan', description: 'Menampilkan pesan bantuan ini.' },
];

module.exports = commands;