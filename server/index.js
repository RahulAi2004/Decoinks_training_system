import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { login, authRequired, adminOnly } from './auth.js';
import practiceRoutes from './routes/practice.js';
import scenarioRoutes from './routes/scenarios.js';
import quizRoutes from './routes/quizzes.js';
import metricsRoutes from './routes/metrics.js';
import adminRoutes from './routes/admin.js';
import studyRoutes from './routes/study.js';
import { activeModelLabel } from './llm.js';
import { DATA_DIR } from './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/real-chat-artwork', express.static(path.join(DATA_DIR, 'real-chat-artwork')));

app.get('/api/health', (req, res) => res.json({ ok: true, model: activeModelLabel() }));

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = login(email, password);
  if (!result) return res.status(401).json({ error: 'Invalid email or password' });
  if (result.error) return res.status(403).json({ error: result.error });
  res.json(result);
});

app.get('/api/auth/me', authRequired, (req, res) => res.json(req.user));

app.use('/api/practice', authRequired, practiceRoutes);
app.use('/api/scenarios', authRequired, scenarioRoutes);
app.use('/api/quizzes', authRequired, quizRoutes);
app.use('/api/metrics', authRequired, metricsRoutes);
app.use('/api/study', authRequired, studyRoutes);
app.use('/api/admin', authRequired, adminOnly, adminRoutes);

const DIST_DIR = path.join(process.cwd(), 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/real-chat-artwork/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// never crash on a bad file or a failed LLM call
app.use((err, req, res, next) => {
  console.error('API error:', err.message);
  res.status(500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.API_PORT || 4000;
app.listen(PORT, () => console.log(`Decoinks Intern Trainer API on http://localhost:${PORT} (LLM: ${activeModelLabel()})`));
