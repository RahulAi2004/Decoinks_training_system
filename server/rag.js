// Retrieval: cosine top-k over doc_chunks (embeddings stored as JSON in SQLite).
// Chunks were embedded with a recorded model; the query embeds with that same model.
import db from './db.js';
import { embedBatch, cosine, LOCAL_MODEL } from './embeddings.js';

let cache = null;  // [{id, kind, content, embedding: Float, model}]
export function invalidateChunkCache() { cache = null; }

function loadChunks() {
  if (cache) return cache;
  cache = db.prepare('SELECT id, kind, content, embedding, embedding_model FROM doc_chunks WHERE embedding IS NOT NULL')
    .all()
    .map(r => ({ id: r.id, kind: r.kind, content: r.content, model: r.embedding_model, embedding: JSON.parse(r.embedding) }));
  return cache;
}

export async function retrieve(query, { k = 6, kinds = null } = {}) {
  const chunks = loadChunks().filter(c => !kinds || kinds.includes(c.kind));
  if (!chunks.length) return [];
  const model = chunks[0].model || LOCAL_MODEL;
  let qv;
  try { [qv] = await embedBatch([query], model); }
  catch { [qv] = await embedBatch([query], LOCAL_MODEL); }
  return chunks
    .map(c => ({ ...c, score: cosine(qv, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function kbContext(query, opts = {}) {
  const hits = await retrieve(query, { k: opts.k ?? 6, kinds: opts.kinds });
  return hits.map((h, i) => `[KB ${i + 1} | ${h.kind}] ${h.content}`).join('\n\n');
}
