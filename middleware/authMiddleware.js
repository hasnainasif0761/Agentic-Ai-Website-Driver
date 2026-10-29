const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Check karein ke Authorization header majood hai aur "Bearer " se shuru ho raha hai
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "No token provided or invalid format" });
    }

    const token = authHeader.split(' ')[1]; // Bearer ke baad wala actual token string

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // User ID attaching (req.user.id)
        next();
    } catch (error) {
        console.log(error)
        return res.status(401).json({ message: "Invalid or expired token ha" });
    }
};

module.exports = {authMiddleware};