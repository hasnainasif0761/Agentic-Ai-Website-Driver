const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    message: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: 'huzaifa@gmail.com' }
}, { timestamps: true });

module.exports = mongoose.model('SystemAnnouncement', announcementSchema);