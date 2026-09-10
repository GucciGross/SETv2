import { config } from '../config.js';
import { CodexSessions } from './sessions.js';
export const codexSessions = new CodexSessions(config.dataDir);
