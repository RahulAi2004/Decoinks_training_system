#!/bin/sh
set -e

node server/seed.js
node server/ingest.js

REAL_CHAT_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare('SELECT COUNT(*) c FROM real_chats').get().c)")"
if [ "$REAL_CHAT_COUNT" = "0" ]; then
  if [ -f "Decoinks-25-Real-Chats.docx" ]; then
    node server/import-real-chats.js Decoinks-25-Real-Chats.docx
  elif [ -f "Decoinks-25-Real-Chats-v2.docx" ]; then
    node server/import-real-chats.js Decoinks-25-Real-Chats-v2.docx
  fi
fi

exec node server/index.js
