#!/bin/sh
set -e

node server/seed.js
node server/ingest.js

# Real customer chats: the 50 successful (ordered/paid) chats with real images.
SUCCESS_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare(\"SELECT COUNT(*) c FROM real_chats WHERE source_filename='Decoinks-All-Customers'\").get().c)")"
if [ "$SUCCESS_COUNT" = "0" ] && [ -f "decoinks-successful-chats.json" ]; then
  node server/import-successful-chats.js
fi

QA_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare('SELECT COUNT(*) c FROM real_chat_qa').get().c)")"
if [ "$QA_COUNT" = "0" ] && [ -f "decoinks-all-customers-qa.json" ]; then
  node server/import-all-customers.js
fi

exec node server/index.js
