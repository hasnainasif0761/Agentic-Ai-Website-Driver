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

const PLAN_AMOUNTS = {
    free: 0,
    basic: 29,
    silver: 79,
    golden: 149
};

const TIER_PRICING = {
    free: 0,
    basic: 29,
    silver: 79,
    golden: 149
};

const GOVERNANCE_PLAN_QUOTAS = {
    free: { quota: 15, isUnlimited: false, price: 0 },
    basic: { quota: 500, isUnlimited: false, price: 29 },
    silver: { quota: 3000, isUnlimited: false, price: 79 },
    golden: { quota: null, isUnlimited: true, price: 149 }
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

const GetBusinessDetailedReport = async (req, res) => {
    try {
        const { userId } = req.params;

        // Explicitly exclude password and raw API key fields
        const business = await User.findById(userId).select(
            '-password -apiKey -openaiApiKey -groqApiKey -geminiApiKey'
        );
        if (!business) {
            return res.status(404).json({ success: false, message: 'Business not found.' });
        }

        const agentSetups = await AgentSetup.find({ userId: business._id }).select(
            '-apiKey -openaiApiKey -groqApiKey -geminiApiKey'
        );

        const rawPayments =
            Array.isArray(business.paymentHistory) && business.paymentHistory.length > 0
                ? business.paymentHistory
                : business.paymentSlip
                ? [
                      {
                          planType: business.planType,
                          slip: business.paymentSlip,
                          updatedBy: 'System',
                          date: business.updatedAt || business.createdAt
                      }
                  ]
                : [];

        let totalPaidAmount = 0;
        const paymentHistory = rawPayments.map((p) => {
            const planKey = (p.planType || business.planType || 'basic').toLowerCase();
            const amount = typeof p.amount === 'number' ? p.amount : (PLAN_AMOUNTS[planKey] ?? 0);
            totalPaidAmount += amount;
            return {
                planType: planKey,
                amount,
                slip: p.slip || '',
                updatedBy: p.updatedBy || 'Admin',
                date: p.date || p.createdAt || new Date()
            };
        });

        const primaryAgent = agentSetups[0] || {};
        const dataSources = [];
        agentSetups.forEach((setup) => {
            if (Array.isArray(setup.dataSources)) {
                setup.dataSources.forEach((ds) => dataSources.push(ds));
            } else if (setup.sourceName || setup.sheetName || setup.dbType) {
                dataSources.push(setup.sourceName || setup.sheetName || setup.dbType);
            }
        });

        const totalMessagesUsed = agentSetups.reduce(
            (sum, s) => sum + (s.messagesUsed || 0),
            business.messagesUsed || 0
        );
        const usageLimit = primaryAgent.usageLimit ?? business.usageLimit ?? 15;

        const aiSetup = {
            aiProvider:
                primaryAgent.aiProvider ||
                primaryAgent.provider ||
                business.aiProvider ||
                'Standard AI Provider',
            modelName: primaryAgent.modelName || primaryAgent.model || business.modelName || 'Default Model',
            hasApiKey: Boolean(primaryAgent.hasApiKey || business.hasApiKey),
            agentCount: agentSetups.length,
            dataSources,
            messagesUsed: totalMessagesUsed,
            usageLimit
        };

        const visitorStats = {
            totalVisitors: primaryAgent.totalVisitors ?? primaryAgent.totalSessions ?? 0,
            avgDuration: primaryAgent.avgDuration || 'N/A'
        };

        const riskFlags = [];
        const loginLogs = Array.isArray(business.loginHistory) ? business.loginHistory : [];
        const uniqueIps = new Set(loginLogs.map((l) => l.ip).filter(Boolean));
        if (uniqueIps.size >= 4) {
            riskFlags.push(`Multiple IP addresses detected (${uniqueIps.size} distinct IPs) on login logs.`);
        }
        if (business.planStatus === 'suspended') {
            riskFlags.push('Account is currently suspended.');
        }
        if (usageLimit > 0 && totalMessagesUsed >= usageLimit) {
            riskFlags.push('Message quota reached 100% limit.');
        }

        return res.status(200).json({
            success: true,
            data: {
                business,
                visitorStats,
                loginHistory: loginLogs,
                aiSetup,
                paymentHistory,
                totalPaidAmount,
                riskFlags,
                auditLogs: business.auditLogs || []
            }
        });
    } catch (err) {
        console.error('GetBusinessDetailedReport Error:', err);
        return res
            .status(500)
            .json({ success: false, message: 'Server error loading detailed business report.' });
    }
};

/**
 * GET /api/admin/businesses/pending-expired-alerts
 * Query params:
 *   - status: 'all' | 'pending_approval' | 'expired'
 *   - search: string (businessName, name, email, phone, city)
 *   - limit: number (default 7 for bell dropdown, higher for full page)
 */
const GetPendingExpiredAlerts = async (req, res) => {
    try {
        const { status = 'all', search = '', limit = 7 } = req.query;
        const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 7, 1), 100);

        const baseFilter = {
            planStatus: { $in: ['pending_approval', 'expired'] }
        };

        if (status === 'pending_approval' || status === 'expired') {
            baseFilter.planStatus = status;
        }

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            baseFilter.$or = [
                { businessName: regex },
                { name: regex },
                { email: regex },
                { phone: regex },
                { city: regex }
            ];
        }

        const businesses = await User.find(baseFilter)
            .select('-password')
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(parsedLimit);

        // Overall metrics across all pending_approval & expired accounts
        const allAlerts = await User.find({
            planStatus: { $in: ['pending_approval', 'expired'] }
        }).select('planType planStatus updatedAt createdAt');

        let pendingCount = 0;
        let expiredCount = 0;
        let pendingRevenue = 0;
        let expiredRevenueAtRisk = 0;
        let slaBreachedCount = 0;

        const now = Date.now();
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;

        const enriched = businesses.map((b) => {
            const doc = b.toObject();
            const tierPrice = TIER_PRICING[(doc.planType || 'free').toLowerCase()] ?? 0;
            const refTime = new Date(doc.updatedAt || doc.createdAt || now).getTime();
            const hoursElapsed = Math.max(0, Math.floor((now - refTime) / (1000 * 60 * 60)));
            const daysElapsed = Math.floor(hoursElapsed / 24);

            const isSlaBreached =
                doc.planStatus === 'pending_approval' && (now - refTime) > twentyFourHoursMs;

            return {
                ...doc,
                tierPrice,
                hoursElapsed,
                daysElapsed,
                isSlaBreached
            };
        });

        allAlerts.forEach((item) => {
            const price = TIER_PRICING[(item.planType || 'free').toLowerCase()] ?? 0;
            const refTime = new Date(item.updatedAt || item.createdAt || now).getTime();

            if (item.planStatus === 'pending_approval') {
                pendingCount += 1;
                pendingRevenue += price;
                if (now - refTime > twentyFourHoursMs) {
                    slaBreachedCount += 1;
                }
            } else if (item.planStatus === 'expired') {
                expiredCount += 1;
                expiredRevenueAtRisk += price;
            }
        });

        return res.status(200).json({
            success: true,
            businesses: enriched,
            metrics: {
                totalAlerts: allAlerts.length,
                pendingCount,
                expiredCount,
                pendingRevenue,
                expiredRevenueAtRisk,
                slaBreachedCount
            }
        });
    } catch (error) {
        console.error('GetPendingExpiredAlerts Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to load pending and expired business alerts.'
        });
    }
};

/**
 * POST /api/admin/business/:userId/subscription-action
 * Body:
 *   - actionType: 'approve' | 'reject' | 'grace_7d' | 'grace_14d' | 'mark_expired'
 *   - reason?: string
 */
const HandleSubscriptionGovernanceAction = async (req, res) => {
    try {
        const { userId } = req.params;
        const { actionType, reason = '' } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Business account not found.' });
        }

        let agent = await AgentSetup.findOne({ userId: user._id });
        if (!agent) {
            agent = await AgentSetup.create({
                userId: user._id,
                businessName: user.businessName || '',
                planType: 'free',
                planStatus: 'active',
                usageLimit: 15,
                messagesUsed: 0,
                carryOverChats: 0
            });
        }

        const now = Date.now();
        const targetPlan = (agent.planType || user.pendingPaymentDetails?.planType || 'basic').toLowerCase();
        const planCfg = GOVERNANCE_PLAN_QUOTAS[targetPlan] || GOVERNANCE_PLAN_QUOTAS.basic;
        const isTargetUnlimited = Boolean(planCfg.isUnlimited) || targetPlan === 'golden';

        const prevUnlimited = agent.planType === 'golden' || agent.usageLimit === null;
        const expiresAtMs = agent.planExpiresAt
            ? new Date(agent.planExpiresAt).getTime()
            : new Date(agent.createdAt || now).getTime() + 30 * 24 * 60 * 60 * 1000;
        const graceMs = agent.gracePeriodUntil ? new Date(agent.gracePeriodUntil).getTime() : 0;
        const effectiveExpiryMs = Math.max(expiresAtMs, graceMs);

        const isDateExpired = now >= effectiveExpiryMs;
        const daysRemaining = Math.max(0, Math.ceil((effectiveExpiryMs - now) / (1000 * 60 * 60 * 24)));

        const prevEffectiveLimit = prevUnlimited
            ? null
            : (agent.usageLimit || 0) + (agent.carryOverChats || 0);
        const prevRemainingChats = prevUnlimited
            ? null
            : Math.max(0, prevEffectiveLimit - (agent.messagesUsed || 0));

        let userUpdateFields = {};
        let responseMessage = 'Subscription updated.';

        if (actionType === 'approve') {
            const carryOverToAdd =
                !isTargetUnlimited && !prevUnlimited && !isDateExpired && (prevRemainingChats || 0) > 0
                    ? prevRemainingChats
                    : 0;

            let totalDays = 30;
            if (!isDateExpired && daysRemaining > 0 && daysRemaining <= 5) {
                totalDays = 30 + daysRemaining;
            }

            const newExpiresAt = new Date(now + totalDays * 24 * 60 * 60 * 1000);
            const newLimit = isTargetUnlimited ? null : planCfg.quota;
            const totalQuotaAfterCarryOver = isTargetUnlimited ? null : (newLimit || 0) + carryOverToAdd;

            agent.planType = targetPlan;
            agent.planStatus = 'active';
            agent.planStartedAt = new Date(now);
            agent.planExpiresAt = newExpiresAt;
            agent.gracePeriodUntil = null;
            agent.usageLimit = newLimit;
            agent.carryOverChats = carryOverToAdd;
            agent.messagesUsed = 0;
            await agent.save();

            const quotaLabel = isTargetUnlimited
                ? 'Unlimited chats'
                : `${totalQuotaAfterCarryOver} total chats (${newLimit} plan + ${carryOverToAdd} carry-over)`;

            userUpdateFields = {
                planStatus: 'active',
                reminder5DaysSent: false,
                expiredNoticeSent: false,
                lastNotification: {
                    type: 'resubscribed',
                    message: `${targetPlan.toUpperCase()} approved & activated (${quotaLabel}, valid for ${totalDays} days).`,
                    sentAt: new Date()
                }
            };

            await User.findByIdAndUpdate(
                userId,
                {
                    $set: userUpdateFields,
                    $push: {
                        paymentHistory: {
                            planType: targetPlan,
                            slip: user.paymentSlip || user.pendingPaymentDetails?.paymentSlipUrl || '',
                            amount: planCfg.price,
                            updatedBy: 'Superadmin (Approved)',
                            date: new Date()
                        },
                        subscriptionLogs: {
                            action: 'approve',
                            fromPlan: agent.planType,
                            toPlan: targetPlan,
                            carryOverAdded: carryOverToAdd,
                            daysAdded: totalDays,
                            note: `Approved by Superadmin. ${quotaLabel}, validity: ${totalDays} days.`,
                            createdAt: new Date()
                        }
                    }
                },
                { runValidators: false }
            );

            responseMessage = `${user.businessName} (${targetPlan.toUpperCase()}) approved & activated — ${quotaLabel} for ${totalDays} days.`;
        } else if (actionType === 'reject') {
            agent.planStatus = 'expired';
            agent.carryOverChats = 0;
            await agent.save();

            userUpdateFields = {
                planStatus: 'expired',
                rejectionReason: reason || 'Payment verification declined by Superadmin.',
                lastNotification: {
                    type: '30_day_expired',
                    message: reason || 'Payment verification declined by Superadmin.',
                    sentAt: new Date()
                }
            };

            await User.findByIdAndUpdate(
                userId,
                { $set: userUpdateFields },
                { new: true, runValidators: false }
            );

            responseMessage = `${user.businessName} request marked as rejected/expired.`;
        } else if (actionType === 'grace_7d' || actionType === 'grace_14d') {
            const days = actionType === 'grace_14d' ? 14 : 7;
            const graceUntil = new Date(now + days * 24 * 60 * 60 * 1000);

            agent.planStatus = 'active';
            agent.gracePeriodUntil = graceUntil;
            await agent.save();

            userUpdateFields = {
                planStatus: 'active',
                gracePeriodUntil: graceUntil,
                expiredNoticeSent: false
            };

            await User.findByIdAndUpdate(
                userId,
                { $set: userUpdateFields },
                { new: true, runValidators: false }
            );

            responseMessage = `${days}-day courtesy grace period granted to ${user.businessName}.`;
        } else if (actionType === 'mark_expired') {
            agent.planStatus = 'expired';
            agent.carryOverChats = 0;
            if (!prevUnlimited) {
                agent.messagesUsed = agent.usageLimit || 0;
            }
            await agent.save();

            userUpdateFields = {
                planStatus: 'expired',
                expiredNoticeSent: true
            };

            await User.findByIdAndUpdate(
                userId,
                { $set: userUpdateFields },
                { new: true, runValidators: false }
            );

            responseMessage = `${user.businessName} marked as expired.`;
        } else {
            return res.status(400).json({ success: false, message: 'Invalid governance action.' });
        }

        const updatedUser = await User.findById(userId).select('-password');
        const updatedAgent = await AgentSetup.findById(agent._id);

        return res.status(200).json({
            success: true,
            message: responseMessage,
            business: updatedUser,
            agent: updatedAgent
        });
    } catch (error) {
        console.error('HandleSubscriptionGovernanceAction Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error executing subscription governance action.'
        });
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
    GetAnnouncementHistory,
    GetBusinessDetailedReport,
    GetPendingExpiredAlerts,
    HandleSubscriptionGovernanceAction
};