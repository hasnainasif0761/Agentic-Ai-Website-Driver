const User = require('../models/User');
const AgentSetup = require('../models/AgentSetup');
const AdminAuditLog = require('../models/AdminAuditLog');

const SubmitPlanUpgrade = async (req, res) => {
    try {
        const userId = req.user.id; // JWT Auth middleware se aayega
        const { planType, transactionId } = req.body;
        const paymentSlip = req.file ? req.file.path : '';

        if (!planType || !transactionId) {
            return res.status(400).json({ 
                success: false, 
                message: "Plan type and Transaction ID are required." 
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User account not found." });
        }

        // Strict Enterprise Protection: Duplicate pending request block
        if (user.planStatus === 'pending_approval') {
            return res.status(400).json({ 
                success: false, 
                message: "Aapki payment request pehle se review mein hai. Mazeed request submit karne ki ijazat nahi hai." 
            });
        }

        // 1. Update User Plan Details using findByIdAndUpdate (Bypasses full-document validation errors)
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                planType: planType,
                planStatus: 'pending_approval',
                pendingPaymentDetails: {
                    transactionId: transactionId,
                    paymentSlipUrl: paymentSlip,
                    submittedAt: new Date()
                }
            },
            { new: true, runValidators: false }
        );

        // 2. Fetch-Modify-Save Pattern for AgentSetup Model
        let agent = await AgentSetup.findOne({ userId });
        if (agent) {
            agent.planType = planType;
            agent.planStatus = 'pending_approval';

            if (planType === 'basic') {
                agent.usageLimit = 500;
            } else if (planType === 'silver') {
                agent.usageLimit = 3000;
            } else if (planType === 'golden') {
                agent.usageLimit = 99999;
            }

            await agent.save();
        } else {
            await AgentSetup.create({
                userId,
                planType,
                planStatus: 'pending_approval',
                usageLimit: planType === 'basic' ? 1000 : planType === 'silver' ? 5000 : 99999
            });
        }

        // 3. Record Audit Log
        await AdminAuditLog.create({
            adminEmail: updatedUser.email,
            action: 'CHANGE_PLAN',
            targetUserId: updatedUser._id,
            details: `User ${updatedUser.email} submitted upgrade request for ${planType.toUpperCase()} plan. TXN: ${transactionId}`
        });

        return res.status(200).json({
            success: true,
            message: "Payment proof submitted successfully! Admin verification pending.",
            user: {
                planType: updatedUser.planType,
                planStatus: updatedUser.planStatus,
                pendingPaymentDetails: updatedUser.pendingPaymentDetails
            }
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const PLAN_CONFIG = {
    free: { quota: 15, isUnlimited: false, price: 0, rank: 0 },
    basic: { quota: 500, isUnlimited: false, price: 29, rank: 1 },
    silver: { quota: 3000, isUnlimited: false, price: 79, rank: 2 },
    golden: { quota: null, isUnlimited: true, price: 149, rank: 3 }
};

async function sendLifecycleEmail({ to, subject, text }) {
    try {
        if (!to) return;
        console.log(`[Notification Email] To: ${to} | Subject: ${subject} | Body: ${text}`);
    } catch (err) {
        console.error('Email notification error:', err.message);
    }
}

async function getOrCreateAgentForUser(userId) {
    let agent = await AgentSetup.findOne({ userId });
    if (!agent) {
        const user = await User.findById(userId).select('businessName');
        agent = await AgentSetup.create({
            userId,
            businessName: user?.businessName || '',
            planType: 'free',
            planStatus: 'active',
            usageLimit: PLAN_CONFIG.free.quota,
            messagesUsed: 0,
            carryOverChats: 0
        });
    }
    return agent;
}

function computeSubscriptionState(agent) {
    const now = Date.now();
    const expiresAtMs = agent.planExpiresAt
        ? new Date(agent.planExpiresAt).getTime()
        : new Date(agent.createdAt || now).getTime() + 30 * 24 * 60 * 60 * 1000;
    const graceMs = agent.gracePeriodUntil ? new Date(agent.gracePeriodUntil).getTime() : 0;
    const effectiveExpiryMs = Math.max(expiresAtMs, graceMs);

    const msRemaining = Math.max(0, effectiveExpiryMs - now);
    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    const isDateExpired = now >= effectiveExpiryMs || agent.planStatus === 'expired';

    const planType = agent.planType || 'free';
    const isUnlimited = planType === 'golden' || agent.usageLimit === null;

    const used = agent.messagesUsed || 0;
    const effectiveLimit = isUnlimited ? null : (agent.usageLimit || 0) + (agent.carryOverChats || 0);
    const remainingChats = isUnlimited ? null : Math.max(0, effectiveLimit - used);
    const isQuotaExhausted = isUnlimited ? false : remainingChats <= 0;

    const canCustomerChat =
        !isDateExpired &&
        !isQuotaExhausted &&
        agent.planStatus !== 'suspended' &&
        agent.planStatus !== 'inactive' &&
        agent.planStatus !== 'pending_approval';

    let blockReason = null;
    if (agent.planStatus === 'suspended') {
        blockReason = 'account_suspended';
    } else if (agent.planStatus === 'pending_approval') {
        blockReason = 'pending_approval';
    } else if (isDateExpired) {
        blockReason = 'plan_expired';
    } else if (isQuotaExhausted) {
        blockReason = 'quota_exhausted';
    }

    return {
        agentId: agent._id,
        planType,
        isUnlimited,
        planStatus: isDateExpired && agent.planStatus === 'active' ? 'expired' : (agent.planStatus || 'active'),
        planExpiresAt: new Date(effectiveExpiryMs),
        daysRemaining,
        isDateExpired,
        usageLimit: isUnlimited ? null : (agent.usageLimit || 0),
        carryOverChats: isUnlimited ? 0 : (agent.carryOverChats || 0),
        effectiveLimit,
        messagesUsed: used,
        remainingChats,
        isQuotaExhausted,
        canCustomerChat,
        blockReason
    };
}

const GetSubscriptionStatus = async (req, res) => {
    try {
        const userId = req.user?._id || req.user?.id || req.query?.userId;
        const user = await User.findById(userId).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const agent = await getOrCreateAgentForUser(user._id);
        const state = computeSubscriptionState(agent);

        if (state.isDateExpired && agent.planStatus === 'active') {
            agent.planStatus = 'expired';
            agent.carryOverChats = 0;
            if (!state.isUnlimited) {
                agent.messagesUsed = agent.usageLimit || 0;
            }
            await agent.save();
        }

        return res.status(200).json({
            success: true,
            subscription: {
                ...state,
                planStatus: state.isDateExpired && agent.planStatus === 'active' ? 'expired' : agent.planStatus,
                lastNotification: user.lastNotification,
                subscriptionLogs: (user.subscriptionLogs || []).slice(-10).reverse(),
                plans: PLAN_CONFIG
            }
        });
    } catch (error) {
        console.error('GetSubscriptionStatus Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load subscription status.' });
    }
};

const ResubscribeOrUpgradePlan = async (req, res) => {
    try {
        const userId = req.user?._id || req.user?.id || req.body?.userId;
        const targetPlanType = req.body?.targetPlanType || req.body?.planType;
        const transactionId = (req.body?.transactionId || '').trim();
        const slipNote = (req.body?.slipNote || '').trim();
        const paymentSlip = req.file ? req.file.path : (req.body?.paymentSlip || slipNote || '');

        if (!targetPlanType || targetPlanType === 'free' || !PLAN_CONFIG[targetPlanType]) {
            return res.status(400).json({
                success: false,
                message: 'Free plan cannot be selected. Please choose Basic, Silver, or Golden.'
            });
        }

        if (!transactionId) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID is required.'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User account not found.' });
        }

        if (user.planStatus === 'pending_approval') {
            return res.status(400).json({
                success: false,
                message: 'Aapki payment request pehle se review mein hai.'
            });
        }

        const agent = await getOrCreateAgentForUser(user._id);
        const currentState = computeSubscriptionState(agent);
        const previousPlan = agent.planType || 'free';
        const isSamePlan = previousPlan === targetPlanType;
        const actionType = isSamePlan ? 'resubscribe' : 'switch_plan';

        const targetIsUnlimited = Boolean(PLAN_CONFIG[targetPlanType].isUnlimited);
        const carryOverPreview =
            !targetIsUnlimited &&
            !currentState.isUnlimited &&
            !currentState.isDateExpired &&
            (currentState.remainingChats || 0) > 0
                ? currentState.remainingChats
                : 0;

        let totalDaysPreview = 30;
        if (!currentState.isDateExpired && currentState.daysRemaining > 0 && currentState.daysRemaining <= 5) {
            totalDaysPreview = 30 + currentState.daysRemaining;
        }

        const newPlanQuota = PLAN_CONFIG[targetPlanType].quota; // null for golden

        agent.planType = targetPlanType;
        agent.planStatus = 'pending_approval';
        agent.usageLimit = newPlanQuota;
        agent.carryOverChats = carryOverPreview;
        await agent.save();

        await User.findByIdAndUpdate(
            userId,
            {
                planType: targetPlanType,
                planStatus: 'pending_approval',
                paymentSlip,
                pendingPaymentDetails: {
                    transactionId,
                    paymentSlipUrl: paymentSlip,
                    carryOverPreview,
                    daysPreview: totalDaysPreview,
                    submittedAt: new Date()
                },
                $push: {
                    subscriptionLogs: {
                        action: actionType,
                        fromPlan: previousPlan,
                        toPlan: targetPlanType,
                        carryOverAdded: carryOverPreview,
                        daysAdded: totalDaysPreview,
                        note: `Submitted for approval (TXN: ${transactionId}). Quota: ${targetIsUnlimited ? 'Unlimited' : newPlanQuota}, carry-over: ${carryOverPreview}, validity: ${totalDaysPreview} days.`,
                        createdAt: new Date()
                    }
                }
            },
            { runValidators: false }
        );

        return res.status(200).json({
            success: true,
            message: `${targetPlanType.toUpperCase()} request submitted! Status is now Pending Approval.`,
            planStatus: 'pending_approval'
        });
    } catch (error) {
        console.error('ResubscribeOrUpgradePlan Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to submit plan request.' });
    }
}; 

async function consumeCustomerChatQuota(userId, count = 1) {
    const agent = await AgentSetup.findOne({ userId });
    if (!agent) {
        return { allowed: false, reason: 'agent_not_found', message: 'AI Agent setup not found.' };
    }

    const state = computeSubscriptionState(agent);

    if (!state.canCustomerChat) {
        if (state.isDateExpired && agent.planStatus === 'active') {
            agent.planStatus = 'expired';
            agent.carryOverChats = 0;
            if (!state.isUnlimited) {
                agent.messagesUsed = agent.usageLimit || 0;
            }
            await agent.save();
        }
        return {
            allowed: false,
            reason: state.blockReason || 'quota_exhausted',
            message:
                state.blockReason === 'plan_expired'
                    ? 'Plan validity has expired. Customer AI chat is paused until plan is resubscribed.'
                    : 'Chat quota exhausted. Customer AI chat is paused until plan is resubscribed or upgraded.'
        };
    }

    // Golden (Unlimited) Plan: Sirf analytics ke liye messagesUsed increment karein, koi numeric cap check nahi
    if (state.isUnlimited) {
        const updatedGoldenAgent = await AgentSetup.findOneAndUpdate(
            {
                _id: agent._id,
                planStatus: { $nin: ['suspended', 'inactive', 'expired', 'pending_approval'] }
            },
            { $inc: { messagesUsed: count } },
            { new: true }
        );

        if (!updatedGoldenAgent) {
            return {
                allowed: false,
                reason: 'plan_expired',
                message: 'Your Golden plan is not active.'
            };
        }

        return {
            allowed: true,
            isUnlimited: true,
            messagesUsed: updatedGoldenAgent.messagesUsed,
            remainingChats: null,
            isQuotaExhausted: false
        };
    }

    if (state.remainingChats < count) {
        return {
            allowed: false,
            reason: 'quota_exhausted',
            message: 'Insufficient remaining chat quota. Please resubscribe or upgrade your plan.'
        };
    }

    const updatedAgent = await AgentSetup.findOneAndUpdate(
        {
            _id: agent._id,
            planStatus: { $nin: ['suspended', 'inactive', 'expired', 'pending_approval'] },
            $expr: {
                $gte: [
                    { $subtract: [{ $add: ['$usageLimit', '$carryOverChats'] }, '$messagesUsed'] },
                    count
                ]
            }
        },
        { $inc: { messagesUsed: count } },
        { new: true }
    );

    if (!updatedAgent) {
        return {
            allowed: false,
            reason: 'quota_exhausted',
            message: 'Chat quota exhausted. Customer AI chat is paused.'
        };
    }

    const afterState = computeSubscriptionState(updatedAgent);
    return {
        allowed: true,
        isUnlimited: false,
        messagesUsed: updatedAgent.messagesUsed,
        remainingChats: afterState.remainingChats,
        isQuotaExhausted: afterState.isQuotaExhausted
    };
}

const RunSubscriptionLifecycleCheck = async (req = null, res = null) => {
    try {
        const now = Date.now();
        const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
        const adminEmail = process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL || '';

        const activeAgents = await AgentSetup.find({
            planStatus: 'active',
            planType: { $ne: 'free' }
        });

        let remindersSent = 0;
        let expiredCount = 0;

        for (const agent of activeAgents) {
            const user = await User.findById(agent.userId);
            if (!user) continue;

            const isUnlimited = agent.planType === 'golden' || agent.usageLimit === null;
            const expiresAtMs = agent.planExpiresAt
                ? new Date(agent.planExpiresAt).getTime()
                : new Date(agent.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000;
            const graceMs = agent.gracePeriodUntil ? new Date(agent.gracePeriodUntil).getTime() : 0;
            const effectiveExpiryMs = Math.max(expiresAtMs, graceMs);
            const timeLeft = effectiveExpiryMs - now;

            if (timeLeft <= 0 && !user.expiredNoticeSent) {
                agent.planStatus = 'expired';
                agent.carryOverChats = 0;
                if (!isUnlimited) {
                    agent.messagesUsed = agent.usageLimit || 0;
                }
                await agent.save();

                user.expiredNoticeSent = true;
                user.lastNotification = {
                    type: '30_day_expired',
                    message: `Plan (${agent.planType.toUpperCase()}) expired after 30-day validity cycle. Customer AI chat is paused until resubscribed.`,
                    sentAt: new Date()
                };
                user.subscriptionLogs.push({
                    action: 'expire',
                    fromPlan: agent.planType,
                    toPlan: agent.planType,
                    carryOverAdded: 0,
                    daysAdded: 0,
                    note: '30-day cycle ended. Customer AI chat paused.',
                    createdAt: new Date()
                });
                await user.save();

                const msg = `Business "${user.businessName}" (${user.email}) ka ${agent.planType.toUpperCase()} plan expire ho gaya hai. Customer AI chat pause hai.`;
                await sendLifecycleEmail({
                    to: user.email,
                    subject: 'Your AI Plan Has Expired — Resubscribe to Resume Customer Chat',
                    text: msg
                });
                if (adminEmail) {
                    await sendLifecycleEmail({
                        to: adminEmail,
                        subject: `[Admin Alert] Tenant Plan Expired: ${user.businessName}`,
                        text: msg
                    });
                }
                expiredCount += 1;
            } else if (timeLeft > 0 && timeLeft <= fiveDaysMs && !user.reminder5DaysSent) {
                const daysLeft = Math.max(1, Math.ceil(timeLeft / (24 * 60 * 60 * 1000)));
                user.reminder5DaysSent = true;
                user.lastNotification = {
                    type: '5_day_warning',
                    message: `Your ${agent.planType.toUpperCase()} plan will expire in ${daysLeft} day(s). Resubscribe/upgrade now to carry forward remaining validity.`,
                    sentAt: new Date()
                };
                user.subscriptionLogs.push({
                    action: 'reminder_5d',
                    fromPlan: agent.planType,
                    toPlan: agent.planType,
                    carryOverAdded: 0,
                    daysAdded: 0,
                    note: `5-day pre-expiry notification sent (${daysLeft} days left).`,
                    createdAt: new Date()
                });
                await user.save();

                const msg = `Business "${user.businessName}" (${user.email}) ka ${agent.planType.toUpperCase()} plan ${daysLeft} din mein expire hone wala hai.`;
                await sendLifecycleEmail({
                    to: user.email,
                    subject: `Reminder: Your AI Plan Expires in ${daysLeft} Days`,
                    text: msg
                });
                if (adminEmail) {
                    await sendLifecycleEmail({
                        to: adminEmail,
                        subject: `[Admin Reminder] Plan Expiring in ${daysLeft}d: ${user.businessName}`,
                        text: msg
                    });
                }
                remindersSent += 1;
            }
        }

        if (res) {
            return res.status(200).json({ success: true, remindersSent, expiredCount });
        }
        return { success: true, remindersSent, expiredCount };
    } catch (error) {
        console.error('RunSubscriptionLifecycleCheck Error:', error);
        if (res) {
            return res.status(500).json({ success: false, message: 'Lifecycle check failed.' });
        }
    }
};

module.exports = {
    PLAN_CONFIG,
    computeSubscriptionState,
    GetSubscriptionStatus,
    ResubscribeOrUpgradePlan,
    consumeCustomerChatQuota,
    RunSubscriptionLifecycleCheck,
    SubmitPlanUpgrade
};