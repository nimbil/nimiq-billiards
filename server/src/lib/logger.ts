/**
 * Logger - Structured logging with Pino
 */

import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logging.level,
  transport: config.logging.prettyPrint
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: { service: 'nimiq-billiards' },
});

export default logger;
