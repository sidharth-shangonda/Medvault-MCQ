import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["student", "admin"], default: "student", index: true },
    active: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date }
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);
