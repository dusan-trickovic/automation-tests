import * as dotenv from 'dotenv';
dotenv.config();
export const WEBHOOK_URL = process.env['SLACK_WEBHOOK_URL'];