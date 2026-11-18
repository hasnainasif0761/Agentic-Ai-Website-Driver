const User = require('../models/User');
const AgentSetup = require('../models/AgentSetup');
const AdminAuditLog = require('../models/AdminAuditLog');
const SystemAnnouncement = require('../models/SystemAnnouncement');
const jwt = require('jsonwebtoken');

const ADMIN_SECRET = process.env.JWT_SECRET || 'super_secret_admin_key';

const PLAN_LIMITS = {
    free: 100,
    basic: 1000,
    silver: 5000,
    golden: 999999
};

const AdminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (email !== 'huzaifa@gmail.com' || password !== 'huzaifa12345') {
            return res.status(401).json({ success: false, message: "Invalid Superadmin Credentials." });
        }

        const token = jwt.sign(
            { email, role: 'superadmin' },
            ADMIN_SECRET,
            { expiresIn: '1d' }
        );

        return res.status(200).json({
            success: true,
            message: "Superadmin Login Successful",
            token,
            admin: { email: 'huzaifa@gmail.com', role: 'superadmin' }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const GetAdminStats = async (req, res) => {
    try {
        const totalBusinesses = await User.countDocuments();
        const pendingRequests = await User.countDocuments({ planStatus: 'pending_approval' });
        const activeUsers = await User.countDocuments({ planStatus: 'active' });
        const suspendedUsers = await User.countDocuments({ planStatus: 'suspended' });

        const users = await User.find({});
        let mrr = 0;
        users.forEach(u => {
            if (u.planStatus === 'active') {
                if (u.planType === 'basic') mrr += 29;
                if (u.planType === 'silver') mrr += 79;
                if (u.planType === 'golden') mrr += 149;
            }
        });

        return res.status(200).json({
            success: true,
            stats: {
                totalBusinesses,
                pendingRequests,
                activeUsers,
                suspendedUsers,
                estimatedMRR: mrr
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const GetAllBusinesses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const search = req.query.search || '';

        const query = search 
            ? { $or: [
                { name: { $regex: search, $options: 'i' } },
                { businessName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
              ]} 
            : {};

        const total = await User.countDocuments(query);
        const businesses = await User.find(query)
            .select('-password')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        return res.status(200).json({
            success: true,
            businesses,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            totalCount: total
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const UpdateBusinessPlanOrStatus = async (req, res) => {
    try {
        const { userId } = req.params; // 🟢 yahan id ki jagah userId karein
        const { actionType, planType, businessName, name, phone, city, country } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Business tenant not found.' });
        }

        // 1. NEW ACTION: Change Plan + Save Payment Slip in History
        if (actionType === 'change_plan_with_slip') {
            const selectedPlan = (planType || 'basic').toLowerCase();
            const newLimit = PLAN_LIMITS[selectedPlan] || 1000;
            const slipPath = req.file ? req.file.path.replace(/\\/g, '/') : user.paymentSlip;

            user.planType = selectedPlan;
            user.planStatus = 'active';
            if (slipPath) user.paymentSlip = slipPath;

            // Push into permanent paymentHistory ledger
            if (!user.paymentHistory) user.paymentHistory = [];
            user.paymentHistory.unshift({
                planType: selectedPlan,
                slip: slipPath || '',
                updatedBy: 'Superadmin',
                date: new Date()
            });

            await user.save();

            // Sync AgentSetup quota & plan status
            const updateAgentFields = {
                planType: selectedPlan,
                planStatus: 'active',
                usageLimit: newLimit
            };
            if (selectedPlan === 'golden') {
                const nextMonth = new Date();
                nextMonth.setDate(nextMonth.getDate() + 30);
                updateAgentFields.planEndDate = nextMonth;
            }

            await AgentSetup.updateMany({ userId: user._id }, { $set: updateAgentFields });

            return res.status(200).json({
                success: true,
                message: `Plan upgraded to ${selectedPlan.toUpperCase()} and payment slip recorded!`,
                business: user
            });
        }

        // 2. Existing Approve Action
        if (actionType === 'approve') {
            const approvedPlan = (planType || user.planType || 'basic').toLowerCase();
            const newLimit = PLAN_LIMITS[approvedPlan] || 1000;

            user.planType = approvedPlan;
            user.planStatus = 'active';
            await user.save();

            await AgentSetup.updateMany(
                { userId: user._id },
                { $set: { planType: approvedPlan, planStatus: 'active', usageLimit: newLimit } }
            );

            return res.status(200).json({ success: true, message: 'Plan approved & activated.' });
        }

        // 3. Existing Suspend / Activate Toggle
        if (actionType === 'suspend') {
            const newStatus = user.planStatus === 'suspended' ? 'active' : 'suspended';
            user.planStatus = newStatus;
            await user.save();

            await AgentSetup.updateMany({ userId: user._id }, { $set: { planStatus: newStatus } });

            return res.status(200).json({ success: true, message: `Account ${newStatus}.` });
        }

        // 4. Existing Edit Details
        if (actionType === 'edit_details') {
            if (businessName) user.businessName = businessName;
            if (name) user.name = name;
            if (phone) user.phone = phone;
            if (city) user.city = city;
            if (country) user.country = country;
            await user.save();

            if (businessName) {
                await AgentSetup.updateMany({ userId: user._id }, { $set: { businessName } });
            }

            return res.status(200).json({ success: true, message: 'Business details updated.' });
        }

        return res.status(400).json({ success: false, message: 'Invalid actionType.' });
    } catch (err) {
        console.error('Admin Update Business Error:', err);
        return res.status(500).json({ success: false, message: 'Server error while updating business.' });
    }
};

const DeleteBusiness = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findByIdAndDelete(userId);
        await AgentSetup.findOneAndDelete({ userId });

        await AdminAuditLog.create({
            adminEmail: 'huzaifa@gmail.com',
            action: 'DELETE_BUSINESS',
            targetUserId: userId,
            details: `Deleted business account ID: ${userId}`
        });

        return res.status(200).json({ success: true, message: "Business deleted successfully." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const GetBusinessDetails360 = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId).select('-password');
        const agent = await AgentSetup.findOne({ userId });
        const historyLogs = await AdminAuditLog.find({ targetUserId: userId }).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            user,
            agent,
            paymentSlips: user.paymentSlip ? [{ slipUrl: user.paymentSlip, uploadedAt: user.createdAt, status: user.planStatus }] : [],
            historyLogs
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const PostAnnouncement = async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, message: "Message is required." });

        await SystemAnnouncement.updateMany({}, { isActive: false });

        const newAnnouncement = await SystemAnnouncement.create({
            message,
            isActive: true,
            createdBy: 'huzaifa@gmail.com'
        });

        return res.status(200).json({
            success: true,
            message: "📢 New Broadcast published successfully across all dashboards!",
            announcement: newAnnouncement
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const GetActiveAnnouncement = async (req, res) => {
    try {
        const active = await SystemAnnouncement.findOne({ isActive: true }).sort({ createdAt: -1 });
        return res.status(200).json({
            success: true,
            announcement: active ? active.message : null
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const GetAnnouncementHistory = async (req, res) => {
    try {
        const history = await SystemAnnouncement.find({}).sort({ createdAt: -1 }).limit(10);
        return res.status(200).json({ success: true, history });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    AdminLogin,
    GetAdminStats,
    GetAllBusinesses,
    UpdateBusinessPlanOrStatus,
    DeleteBusiness,
    GetBusinessDetails360,
    PostAnnouncement,
    GetActiveAnnouncement,
    GetAnnouncementHistory
};