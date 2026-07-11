import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { buildCustomerLibraryJson, importCustomerLibraryFromJson } from './services/successfulChats.js';

const DOCX = path.join(process.cwd(), 'Decoinks-All-Customers.docx');
const JSON_FILE = path.join(process.cwd(), 'decoinks-customer-library.json');
const rebuild = process.argv.includes('--rebuild');

try {
  if ((rebuild || !fs.existsSync(JSON_FILE)) && fs.existsSync(DOCX)) {
    const result = await buildCustomerLibraryJson(DOCX, JSON_FILE);
    console.log(`Built customer library: ${result.chats} chats, ${result.withImages} with artwork (${result.images} images).`);
  }
  const result = importCustomerLibraryFromJson(JSON_FILE);
  console.log(`Customer library ready: ${result.total} source chats, ${result.added} added, ${result.refreshed} refreshed, ${result.matchedActive} already active.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
