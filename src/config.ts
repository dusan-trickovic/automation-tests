// Uncomment the following lines to use the .env file
import * as dotenv from 'dotenv';
dotenv.config();
export const WEBHOOK_URL = process.env['SLACK_WEBHOOK_URL'];
export const ACCESS_TOKEN = process.env['PERSONAL_ACCESS_TOKEN'];
