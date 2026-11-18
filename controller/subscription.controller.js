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

module.exports = {
    SubmitPlanUpgrade
};