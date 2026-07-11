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
    .flatMap(r => {
      try {
        const embedding = JSON.parse(r.embedding);
        return Array.isArray(embedding)
          ? [{ id: r.id, kind: r.kind, content: r.content, model: r.embedding_model || LOCAL_MODEL, embedding }]
          : [];
      } catch {
        // One damaged row should not disable retrieval for the entire KB.
        return [];
      }
    });
  return cache;
}

export async function retrieve(query, { k = 6, kinds = null } = {}) {
  const chunks = loadChunks().filter(c => !kinds || kinds.includes(c.kind));
  if (!chunks.length) return [];
  // An index can temporarily contain multiple embedding models during a
  // re-ingest. Embed the query once per model and compare only compatible
  // vectors; comparing the first 512 dimensions of a 1536-d vector produces
  // plausible-looking but invalid rankings.
  const queryVectors = new Map();
  for (const model of new Set(chunks.map(c => c.model))) {
    try {
      const [vector] = await embedBatch([String(query || '')], model);
      queryVectors.set(model, vector);
    } catch (e) {
      console.error(`RAG query embedding failed for ${model}:`, e.message);
    }
  }
  return chunks
    .filter(c => queryVectors.has(c.model))
    .map(c => ({ ...c, score: cosine(queryVectors.get(c.model), c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function kbContext(query, opts = {}) {
  const hits = await retrieve(query, { k: opts.k ?? 6, kinds: opts.kinds });
  return hits.map((h, i) => `[KB ${i + 1} | ${h.kind}] ${h.content}`).join('\n\n');
}
