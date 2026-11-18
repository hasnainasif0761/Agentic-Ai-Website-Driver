const { default: mongoose } = require("mongoose");

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
    paymentHistory: [
    {
        planType: { type: String },
        slip: { type: String },
        updatedBy: { type: String, default: 'Superadmin' },
        date: { type: Date, default: Date.now }
    }
],
}, { timestamps: true });

const User = mongoose.model('AiUser', userSchema);

module.exports = User;