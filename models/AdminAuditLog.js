const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
    adminEmail: { 
        type: String, 
        required: true, 
        default: 'huzaifa@gmail.com' 
    },
    action: { 
        type: String, 
        required: true,
        enum: [
            'APPROVE', 
            'SUSPEND', 
            'CHANGE_PLAN', 
            'EDIT_DETAILS', 
            'DELETE_BUSINESS', 
            'UPDATE_USER'
        ]
    },
    targetUserId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: false 
    },
    details: { 
        type: String, 
        required: true 
    },
    ipAddress: {
        type: String,
        default: null
    }
}, { 
    timestamps: true 
});

// Fast querying by targetUserId and date
adminAuditLogSchema.index({ targetUserId: 1, createdAt: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);