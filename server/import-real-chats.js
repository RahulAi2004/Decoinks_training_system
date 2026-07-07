import 'dotenv/config';
import { importRealChats } from './services/realChats.js';

try {
  const result = await importRealChats(process.argv[2]);
  console.log(`Imported ${result.chats} real chats with ${result.images} artwork image(s).`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
