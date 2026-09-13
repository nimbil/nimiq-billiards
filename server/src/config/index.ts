/**
 * Server Configuration
 * 
 * Environment-based configuration with defaults for development.
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // Database (PostgreSQL)
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/nimiq_billiards',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    maxRetries: 3,
    retryDelay: 1000,
  },

  // Game
  game: {
    matchTimeoutMs: 5 * 60 * 1000, // 5 minutes
    disconnectGraceMs: 30 * 1000, // 30 seconds
    turnTimeLimitMs: 60 * 1000, // 60 seconds
    physicsFps: 60,
    maxReconnectAttempts: 5,
  },

  // Matchmaking
  matchmaking: {
    // How often to process queues (ms)
    processIntervalMs: 1000,
    
    // Maximum rating difference for initial match
    maxRatingDiff: 200,
    
    // How much to relax rating constraint per second of waiting
    // After 60 seconds, allow up to maxRatingDiff
    ratingRelaxationPerSecond: 200 / 60,
    
    // Maximum queue time before forced match (seconds)
    maxQueueTime: 120,
    
    // Preferred latency difference (ms)
    maxLatencyDiff: 100,
    
    // Priority weights for matching score
    weights: {
      rating: 0.5,
      queueTime: 0.3,
      latency: 0.2,
    },
  },

  // Rate limiting
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    maxShotsPerMinute: 30,
  },

  // Tiers (legacy, kept for compatibility)
  tiers: {
    bronze: { entryFee: 10_000_000, platformFeePercent: 5, minimumBalance: 20_000_000 },
    silver: { entryFee: 50_000_000, platformFeePercent: 5, minimumBalance: 100_000_000 },
    gold: { entryFee: 100_000_000, platformFeePercent: 5, minimumBalance: 200_000_000 },
    diamond: { entryFee: 500_000_000, platformFeePercent: 3, minimumBalance: 1_000_000_000 },
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.NODE_ENV !== 'production',
  },
} as const;

export type Config = typeof config;
export default config;
