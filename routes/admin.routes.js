const express = require('express');
const router = express.Router();
const { 
    AdminLogin, 
    GetAdminStats, 
    GetAllBusinesses, 
    UpdateBusinessPlanOrStatus, 
    DeleteBusiness, 
    GetBusinessDetails360,
    PostAnnouncement,
    GetActiveAnnouncement,
    GetAnnouncementHistory
} = require('../controller/admin.controller'); // Ensuring correct folder path
const SystemAnnouncement = require('../models/SystemAnnouncement');
const multer = require('multer');
const path = require('path')

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Make sure 'uploads' folder exists in root
    },
    filename: (req, file, cb) => {
        cb(null, `slip_${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage });


router.post('/login', AdminLogin);
router.get('/stats', GetAdminStats);
router.get('/businesses', GetAllBusinesses);
router.get('/business/:userId', GetBusinessDetails360);
router.put('/business/:userId',upload.single('paymentSlip'), UpdateBusinessPlanOrStatus);
router.delete('/business/:userId', DeleteBusiness);

// Broadcast Routes
router.post('/broadcast', PostAnnouncement);
router.get('/broadcast/active', GetActiveAnnouncement);
router.get('/broadcast/history', GetAnnouncementHistory);

// Get Active System Broadcast for Tenants/Admins
router.get('/system-broadcast', async (req, res) => {
    try {
        // Aap yahan koi Broadcast model use kar sakte hain jo superadmin update karta ho
        const broadcast = await SystemAnnouncement.findOne({ isActive: true }).sort({ createdAt: -1 });
        return res.status(200).json({ success: true, broadcast });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;