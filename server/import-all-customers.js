import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { buildQaJson, importQaFromJson } from './services/realChatQa.js';

const DOCX = path.join(process.cwd(), 'Decoinks-All-Customers.docx');
const JSON_FILE = path.join(process.cwd(), 'decoinks-all-customers-qa.json');

try {
  // Build the compact JSON from the source docx when it is present (dev machine).
  if (fs.existsSync(DOCX)) {
    const n = await buildQaJson(DOCX, JSON_FILE);
    console.log(`Built ${JSON_FILE} with ${n} Q&A pairs from the docx.`);
  }
  const imported = await importQaFromJson(JSON_FILE);
  console.log(`Imported ${imported} real-chat Q&A pairs into the training pool.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
