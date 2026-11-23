const { default: mongoose } = require("mongoose");

const PLAN_QUOTAS = {
    free: 15,
    basic: 500,
    silver: 3000,
    golden: 15000
};

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Please enter your name"]
    },
    businessName: {
        type: String,
        required: [true, "Please enter your business name"]
    },
    email: {
        type: String,
        unique: true,
        required: [true, "Please enter your email"]
    },
    phone: {
        type: String,
        required: [true, "Please enter your phone number"]
    },
    city: {
        type: String,
        required: [true, "Please enter your city"]
    },
    country: {
        type: String,
        required: [true, "Please enter your country"]
    },
    planType: {
        type: String,
        enum: ['free', 'basic', 'silver', 'golden'],
        default: 'free'
    },
    planStatus: {
        type: String,
        enum: ['active', 'pending_approval', 'suspended', 'inactive', 'expired'],
        default: 'active'
    },
    paymentSlip: {
        type: String,
        default: ''
    },
    password: {
        type: String,
        required: true
    },

    // Subscription Validity & Quota Tracking
    planStartedAt: {
        type: Date,
        default: Date.now
    },
    planExpiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },
    usageLimit: {
        type: Number,
        default: 15
    },
    messagesUsed: {
        type: Number,
        default: 0
    },
    carryOverChats: {
        type: Number,
        default: 0
    },
    gracePeriodUntil: {
        type: Date,
        default: null
    },

   reminder5DaysSent: {
        type: Boolean,
        default: false
    },
    expiredNoticeSent: {
        type: Boolean,
        default: false
    },
    lastNotification: {
        type: {
            type: String, // '5_day_warning' | '30_day_expired' | 'resubscribed' | 'quota_exhausted'
            default: null
        },
        message: {
            type: String,
            default: ''
        },
        sentAt: {
            type: Date,
            default: null
        }
    },

    paymentHistory: [
        {
            planType: { type: String },
            slip: { type: String },
            amount: { type: Number },
            updatedBy: { type: String, default: 'Superadmin' },
            date: { type: Date, default: Date.now }
        }
    ],
    subscriptionLogs: [
        {
            action: { type: String }, // 'subscribe' | 'resubscribe' | 'upgrade' | 'expire' | 'reminder_5d'
            fromPlan: { type: String },
            toPlan: { type: String },
            carryOverAdded: { type: Number, default: 0 },
            daysAdded: { type: Number, default: 30 },
            note: { type: String },
            createdAt: { type: Date, default: Date.now }
        }
    ],
    loginCount: {
        type: Number,
        default: 0
    },
    lastLoginAt: {
        type: Date,
        default: null
    },
    loginHistory: [
        {
            ip: { type: String, default: 'Unknown IP' },
            browser: { type: String, default: 'Unknown Browser' },
            timestamp: { type: Date, default: Date.now }
        }
    ]
}, { timestamps: true });

userSchema.statics.PLAN_QUOTAS = PLAN_QUOTAS;

const User = mongoose.model('AiUser', userSchema);

module.exports = User;