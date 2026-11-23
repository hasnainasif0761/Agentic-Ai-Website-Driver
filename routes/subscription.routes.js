const express = require('express');
const router = express.Router();
const { SubmitPlanUpgrade, GetSubscriptionStatus,
    ResubscribeOrUpgradePlan,
    RunSubscriptionLifecycleCheck } = require('../controller/subscription.controller');
const { authMiddleware } = require('../middleware/authMiddleware');
const multer = require('multer');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Ensure 'uploads' folder exists in backend root
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// POST /api/subscription/upgrade
router.put('/upgrade-plan',authMiddleware , upload.single('paymentSlip'), SubmitPlanUpgrade);
router.get('/status',authMiddleware, GetSubscriptionStatus);
router.post('/resubscribe-or-upgrade',authMiddleware ,upload.single('paymentSlip'), ResubscribeOrUpgradePlan);
router.post('/lifecycle-check',authMiddleware , RunSubscriptionLifecycleCheck);

module.exports = router;