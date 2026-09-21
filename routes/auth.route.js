const express = require('express');
// Controller se LoginUser aur RegisterUser import karein
const { LoginUser, RegisterUser } = require('../controller/user.controller');

const router = express.Router();

// Login Route
router.post('/login', LoginUser);

// Register Route
router.post('/registerUser', RegisterUser);

module.exports = router;