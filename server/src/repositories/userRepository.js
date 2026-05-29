import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { getDatabaseMode } from "../db.js";
import { User } from "../models/User.js";

const memoryUsers = new Map();

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    role: user.role || "student"
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user._id || user.id),
      email: user.email,
      role: user.role || "student"
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export async function createUser({ name, email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const displayName = String(name || "").trim();
  if (!displayName) throw Object.assign(new Error("Name is required"), { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw Object.assign(new Error("Valid email is required"), { status: 400 });
  if (String(password || "").length < 6) throw Object.assign(new Error("Password must be at least 6 characters"), { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);

  if (getDatabaseMode() === "mongo") {
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) throw Object.assign(new Error("Email already registered"), { status: 409 });
    const user = await User.create({ name: displayName, email: normalizedEmail, passwordHash });
    return issueSession(user);
  }

  if (memoryUsers.has(normalizedEmail)) throw Object.assign(new Error("Email already registered"), { status: 409 });
  const user = {
    id: `user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: displayName,
    email: normalizedEmail,
    passwordHash,
    role: "student",
    active: true
  };
  memoryUsers.set(normalizedEmail, user);
  return issueSession(user);
}

export async function loginUser({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let user;

  if (getDatabaseMode() === "mongo") {
    user = await User.findOne({ email: normalizedEmail });
  } else {
    user = memoryUsers.get(normalizedEmail);
  }

  if (!user || !user.active) throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!ok) throw Object.assign(new Error("Invalid email or password"), { status: 401 });

  if (getDatabaseMode() === "mongo") {
    user.lastLoginAt = new Date();
    await user.save();
  } else {
    user.lastLoginAt = new Date();
  }

  return issueSession(user);
}

export async function getUserFromToken(token) {
  if (!token) return null;
  const payload = jwt.verify(token, config.jwtSecret);

  if (getDatabaseMode() === "mongo") {
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return null;
    return publicUser(user);
  }

  for (const user of memoryUsers.values()) {
    if (user.id === payload.sub && user.active) return publicUser(user);
  }
  return null;
}

function issueSession(user) {
  const publicProfile = publicUser(user);
  const token = signToken(user);
  const decoded = jwt.decode(token);
  return {
    user: publicProfile,
    token,
    expiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null
  };
}
