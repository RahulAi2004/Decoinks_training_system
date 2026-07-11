import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { buildSuccessfulJson, importSuccessfulFromJson } from './services/successfulChats.js';

const DOCX = path.join(process.cwd(), 'Decoinks-All-Customers.docx');
const JSON_FILE = path.join(process.cwd(), 'decoinks-successful-chats.json');

try {
  if (fs.existsSync(DOCX)) {
    const { chats, withImages } = await buildSuccessfulJson(DOCX, JSON_FILE);
    console.log(`Built ${JSON_FILE}: ${chats} successful chats (${withImages} with real images).`);
  }
  const n = importSuccessfulFromJson(JSON_FILE);
  console.log(`Imported ${n} successful customer chats into the practice replay.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
