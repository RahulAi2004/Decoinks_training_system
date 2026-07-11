#!/bin/sh
set -e

node server/seed.js

# Ingest bundled/uploaded knowledge on a fresh database only. Re-ingesting every
# restart replaces all document/chunk rows and can make startup slow or costly
# when remote embeddings are enabled. Admins can explicitly re-ingest from the
# Content page after changing files.
DOC_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare(\"SELECT COUNT(*) c FROM documents WHERE parsed_status='ready'\").get().c)")"
if [ "$DOC_COUNT" = "0" ]; then
  node server/ingest.js
else
  echo "Knowledge base already contains $DOC_COUNT ready document(s); skipping startup ingest."
fi

# Real customer chats: the 50 successful (ordered/paid) chats with real images.
SUCCESS_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare(\"SELECT COUNT(*) c FROM real_chats WHERE source_filename='Decoinks-All-Customers'\").get().c)")"
if [ "$SUCCESS_COUNT" = "0" ] && [ -f "decoinks-successful-chats.json" ]; then
  node server/import-successful-chats.js
fi

LIBRARY_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare(\"SELECT COUNT(*) c FROM real_chats WHERE source_filename='Decoinks-All-Customers-Library'\").get().c)")"
if [ "$LIBRARY_COUNT" = "0" ] && [ -f "decoinks-customer-library.json" ]; then
  node server/import-customer-library.js
fi

QA_COUNT="$(node --input-type=module -e "import db from './server/db.js'; console.log(db.prepare('SELECT COUNT(*) c FROM real_chat_qa').get().c)")"
if [ "$QA_COUNT" = "0" ] && [ -f "decoinks-all-customers-qa.json" ]; then
  node server/import-all-customers.js
fi

exec node server/index.js
