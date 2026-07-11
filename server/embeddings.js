// Embeddings: OpenAI text-embedding-3-small when a key exists, otherwise a local
// deterministic hashed bag-of-words vector (512-dim) so RAG works fully offline.
// The model used at ingest time is stored per chunk; queries embed with the same method.
import 'dotenv/config';

export const LOCAL_MODEL = 'local-hash-512';
export const OPENAI_MODEL = 'text-embedding-3-small';
const DIM = 512;

export function preferredModel() {
  return process.env.OPENAI_API_KEY ? OPENAI_MODEL : LOCAL_MODEL;
}

function tokenize(text) {
  return (text.toLowerCase().normalize('NFKD').match(/[a-z0-9áéíóúñü$%"']+/g) || []);
}

// FNV-1a hash → bucket
function hashToken(tok) {
  let h = 0x811c9dc5;
  for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return Math.abs(h);
}

export function localEmbed(text) {
  const v = new Float32Array(DIM);
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    v[hashToken(t) % DIM] += 1;
    if (i + 1 < toks.length) v[hashToken(t + '_' + toks[i + 1]) % DIM] += 0.5;  // bigrams
  }
  let norm = 0; for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, x => +(x / norm).toFixed(6));
}

export async function embedBatch(texts, model = preferredModel()) {
  if (model === LOCAL_MODEL) return texts.map(localEmbed);
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.data.map(d => d.embedding);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}
