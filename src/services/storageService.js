// src/services/storageService.js
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SCHEDULE_FILE_PATH = path.join(__dirname, '../../scheduled_messages.json');

function readSchedules() {
    try {
        if (fs.existsSync(SCHEDULE_FILE_PATH)) {
            const data = fs.readFileSync(SCHEDULE_FILE_PATH, 'utf-8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        logger.error(`Error reading schedules: ${error.message}`);
        return [];
    }
}

function writeSchedules(schedules) {
    try {
        fs.writeFileSync(SCHEDULE_FILE_PATH, JSON.stringify(schedules, null, 2), 'utf-8');
    } catch (error) {
        logger.error(`Error writing schedules: ${error.message}`);
    }
}

module.exports = {
    addScheduledMessage: (schedule) => {
        const schedules = readSchedules();
        schedule.id = Date.now().toString(); // ID unik sederhana
        schedules.push(schedule);
        writeSchedules(schedules);
        logger.info(`Pesan terjadwal ditambahkan: ${schedule.id}`);
        return schedule;
    },

    getDueMessages: () => {
        const now = new Date();
        return readSchedules().filter(schedule => {
            const scheduledTime = new Date(schedule.dateTime);
            return !schedule.sent && scheduledTime <= now;
        });
    },

    markAsSent: (scheduleId) => {
        const schedules = readSchedules();
        const index = schedules.findIndex(s => s.id === scheduleId);
        if (index !== -1) {
            schedules[index].sent = true;
            writeSchedules(schedules);
            logger.info(`Pesan ${scheduleId} ditandai sebagai terkirim.`);
        }
    },

    getAllSchedules: () => {
        return readSchedules().filter(s => !s.sent);
    },

    cancelSchedule: (scheduleId) => {
        let schedules = readSchedules();
        const initialLength = schedules.length;
        schedules = schedules.filter(s => s.id !== scheduleId);
        if (schedules.length < initialLength) {
            writeSchedules(schedules);
            logger.info(`Pesan terjadwal ${scheduleId} dibatalkan.`);
            return true;
        }
        return false;
    }
};