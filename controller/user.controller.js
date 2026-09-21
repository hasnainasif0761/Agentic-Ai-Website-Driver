const  User  = require("../models/User");

const LoginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation: Email aur Password check karein
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // Database mein User dhoondein
        const user = await User.findOne({ email });

        // Agar user na mile
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Password verification (agar bcrypt use kar rahe hain toh bcrypt.compare use karein)
        if (user.password !== password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        console.log("User Login Successfully");

        // Frontend ko Success Response bhejein
        return res.status(200).json({
            message: "Login successful",
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};
const RegisterUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation: Required fields check karein
        if (!name || !email || !password) {
            return res.status(400).json({ message: "All fields (name, email, password) are required" });
        }

        // Check karein ke user pehle se exist toh nahi karta
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User with this email already exists" });
        }

        // Naya User create karein
        const newUser = new User({
            name,
            email,
            password
        });

        await newUser.save();

        console.log("User Registered Successfully");

        return res.status(201).json({
            message: "User registered successfully",
            user: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email
            }
        });

    } catch (error) {
        console.error("Registration Error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};






module.exports = {LoginUser,RegisterUser};