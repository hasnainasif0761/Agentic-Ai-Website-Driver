const { default: mongoose } = require("mongoose")

const connectDB = async() =>{
    try {
        await mongoose.connect("mongodb+srv://yt:9kV0gJ8EaRRzI3Pe@yt-complete-backend.lvj3rtn.mongodb.net/")
        console.log("Database Connected")
    } catch (error) {
        console.log("Database is Not Connected")
    }
}

module.exports = connectDB


