// Study: browse + search the ingested knowledge base & training material.
import { Router } from 'express';
import fs from 'fs';
import db from '../db.js';
import { retrieve } from '../rag.js';

const r = Router();

r.get('/documents', (req, res) => {
  // Feature the "how to reply" guidance and the detailed reply bank at the top —
  // these are the most useful starting points for an intern learning to reply.
  res.json(db.prepare(`
    SELECT id, kind, filename, parsed_status, chunk_count,
      CASE
        WHEN filename LIKE '%Source-of-Truth%' THEN 1
        WHEN filename LIKE '%How-To-Reply%' THEN 1
        WHEN filename LIKE '%Detailed-5-Replies%' OR filename LIKE '%detailed_5_replies%' THEN 1
        ELSE 0
      END AS featured,
      CASE
        WHEN filename LIKE '%Source-of-Truth%' THEN 0
        WHEN filename LIKE '%How-To-Reply%' THEN 1
        WHEN filename LIKE '%Detailed-5-Replies%' OR filename LIKE '%detailed_5_replies%' THEN 2
        ELSE 3
      END AS sort_rank
    FROM documents WHERE parsed_status = 'ready'
    ORDER BY sort_rank, kind, filename
  `).all());
});

r.get('/documents/:id/chunks', (req, res) => {
  const rows = db.prepare('SELECT id, content FROM doc_chunks WHERE document_id = ? ORDER BY rowid').all(req.params.id);
  res.json(rows);
});

r.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const hits = await retrieve(q, { k: 10 });
  res.json(hits.map(h => ({ id: h.id, kind: h.kind, content: h.content, score: +h.score.toFixed(3) })));
});

r.get('/company-products', (req, res) => {
  res.json(db.prepare(`
    SELECT id, topic, youtube_url, document_filename,
      substr(COALESCE(document_text, ''), 1, 420) AS preview,
      created_at
    FROM company_products ORDER BY created_at DESC
  `).all());
});

r.get('/company-products/:id', (req, res) => {
  const row = db.prepare(`
    SELECT id, topic, youtube_url, document_filename, document_text, created_at
    FROM company_products WHERE id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product topic not found' });
  res.json(row);
});

r.get('/company-products/:id/download', (req, res) => {
  const row = db.prepare('SELECT * FROM company_products WHERE id = ?').get(req.params.id);
  if (!row || !row.document_path || !fs.existsSync(row.document_path)) return res.status(404).json({ error: 'Document not found' });
  res.download(row.document_path, row.document_filename || 'company-product.docx');
});

export default r;
