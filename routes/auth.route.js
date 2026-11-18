const express = require('express');
const { LoginUser, RegisterUser, updateUser,changePassword } = require('../controller/user.controller');
const multer = require('multer');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');

// Multer Setup for handling file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Login Route
router.post('/login', LoginUser);

// Register Route
router.post('/registerUser',upload.single('paymentSlip'), RegisterUser);
router.put('/update-profile',authMiddleware,updateUser)
router.put('/change-password',authMiddleware,changePassword)

module.exports = router;