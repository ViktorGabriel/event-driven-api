import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisConnection.on("error", (err) => {
  // Silent log or handle connection error in disconnected environments
  if (env.NODE_ENV !== "test") {
    console.error("[Redis Error]", err.message);
  }
});
