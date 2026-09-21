const { default: mongoose } = require("mongoose");

const userSchema = new mongoose.Schema({
    name:{
        type:String,
        required:[true,"Please Enter your name"]
    },
    email:{
        type:String,
        unique:true,
        required:[true,"Please enter your email"]
    },
    password:{
        type:Number
    }
})

const User = mongoose.model('AiUser',userSchema)

module.exports = User