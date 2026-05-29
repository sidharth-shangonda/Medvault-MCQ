import mongoose from "mongoose";
import { config } from "./config.js";

let mode = "file";

export async function connectDatabase() {
  if (!config.mongoUri) {
    mode = "file";
    return { mode };
  }

  await mongoose.connect(config.mongoUri, {
    autoIndex: true,
    serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs
  });
  mode = "mongo";
  return { mode };
}

export function getDatabaseMode() {
  return mode;
}
