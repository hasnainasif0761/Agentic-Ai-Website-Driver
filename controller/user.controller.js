const User = require("../models/User");
const AgentSetup = require("../models/AgentSetup");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET; 

// LOGIN USER
const LoginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.planStatus === 'suspended') {
            return res.status(403).json({
            success: false,
            message: "Aapka account suspend kar diya gaya hai. Mazeed maloomat ke liye administration se rabta karein."
        });
        }

        // Password Comparison with bcrypt
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const clientIp =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress ||
            'Unknown IP';
        const userAgent = req.headers['user-agent'] || 'Unknown Browser';

        const updatedLoginEntry = {
            ip: clientIp,
            browser: userAgent,
            timestamp: new Date()
        };

        await User.findByIdAndUpdate(
            user._id,
            {
                $inc: { loginCount: 1 },
                $set: { lastLoginAt: new Date() },
                $push: {
                    loginHistory: {
                        $each: [updatedLoginEntry],
                        $position: 0,
                        $slice: 50
                    }
                }
            },
            { runValidators: false }
        );

        // JWT Token Generate karein
        const token = jwt.sign(
            { id: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: "7d" } 
        );

        console.log("User Login Successfully");

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                businessName: user.businessName,
                planType: user.planType,
                planStatus: user.planStatus
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

// REGISTER USER
const RegisterUser = async (req, res) => {
    try {
        const { name, businessName, email, phone, city, country, planType, password } = req.body;

        if (!name || !businessName || !email || !phone || !city || !country || !password) {
            return res.status(400).json({ message: "All required registration fields must be filled" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User with this email already exists" });
        }

        // Handle payment slip file upload if present
        let paymentSlipPath = '';
        if (req.file) {
            paymentSlipPath = req.file.path || req.file.filename || req.file.originalname;
        }

        // Determine plan status: Free is active immediately, Paid plans require admin approval
        const selectedPlan = planType || 'free';
        const planStatus = selectedPlan === 'free' ? 'active' : 'pending_approval';

        // Password Hashing
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            name,
            businessName,
            email,
            phone,
            city,
            country,
            planType: selectedPlan,
            planStatus,
            paymentSlip: paymentSlipPath,
            password: hashedPassword
        });

        await newUser.save();

        // Automatically create a corresponding AgentSetup profile for this user
        let usageLimit = 15;
        if (selectedPlan === 'basic') usageLimit = 500;
        if (selectedPlan === 'silver') usageLimit = 3000;
        if (selectedPlan === 'golden') usageLimit = 999999;

        await AgentSetup.create({
            userId: newUser._id,
            planType: selectedPlan,
            planStatus: planStatus,
            usageLimit: selectedPlan === 'free' ? 15 : (selectedPlan === 'basic' ? 500 : 3000),
            messagesUsed: 0
        });

        // Generate JWT Token
        const token = jwt.sign(
            { id: newUser._id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        console.log("User Registered Successfully");

        return res.status(201).json({
            message: "User registered successfully",
            token,
            user: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                businessName: newUser.businessName,
                planType: newUser.planType,
                planStatus: newUser.planStatus
            }
        });

    } catch (error) {
        console.error("Registration Error:", error);
        return res.status(500).json({ message: `Registration Failed: ${error.message}` });
    }
};

const updateUser = async(req,res)=>{
    try {
        const { name, email, company, avatar } = req.body;
        const userId = req.user._id || req.user.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Email uniqueness check agar email change ki gayi ho
        if (email && email.toLowerCase() !== user.email) {
            const emailExists = await User.findOne({ email: email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({ success: false, message: "Yeh email pehle se kisi aur account par registered hai." });
            }
            user.email = email.toLowerCase().trim();
        }

        if (name) user.name = name.trim();
        if (avatar) user.avatar = avatar; // Cloudinary URL ya base64 string

        await user.save();

        // Agar AgentSetup mein businessName bhi update karna ho
        if (company) {
            await AgentSetup.findOneAndUpdate(
                { userId },
                { $set: { businessName: company.trim() } }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully!",
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar
            }
        });
    } catch (err) {
        console.error("Update Profile Error:", err);
        return res.status(500).json({ success: false, message: "Server error while updating profile." });
    }
}

const changePassword = async(req,res)=>{
    try {
        const { oldPassword, newPassword } = req.body;
        const userId = req.user._id || req.user.id;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old aur New dono passwords zaroori hain." });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "New password kam az kam 6 characters ka hona chahiye." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Old password verify karein
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Aapka purana (current) password ghalat hai." });
        }

        // New password hash karke save karein
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Password successfully change ho gaya hai!"
        });
    } catch (err) {
        console.error("Change Password Error:", err);
        return res.status(500).json({ success: false, message: "Server error while changing password." });
    }
}

module.exports = { LoginUser, RegisterUser,updateUser, changePassword };