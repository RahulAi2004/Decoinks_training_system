# Decoinks Intern Trainer & Evaluation Portal

Trains new sales interns to chat like a real Decoinks agent: study the real knowledge base,
practise against AI-simulated customers, get every reply auto-evaluated on a 6-dimension
rubric, and give the admin the metrics to decide **READY / NOT READY**.

## Quick start

```bash
npm install
copy .env.example .env        # then edit .env (see below)
npm run seed                  # demo admin + intern, personas, settings, starter quiz bank
npm run ingest                # parse + chunk + embed everything in ./content/
npm run dev                   # API on :4000, app on http://localhost:5173
```

**Demo logins**
- Admin — `admin@decoinks.com` / `admin123`
- Intern — `intern@decoinks.com` / `intern123`

## .env

| Var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Real AI simulator/evaluator/quiz-gen. **Without any key the app still runs** in mock mode: scripted customer personas, heuristic scoring (labelled `mock`), local hash embeddings. |
| `JWT_SECRET` | Session signing — set to a long random string. |
| `PORT` | API port (default 4000). |
| `DATABASE_URL` | Blank = SQLite at `data/app.db` (default). The schema mirrors the Postgres+pgvector design in `server/db.js`; porting = swapping the driver. |

If `OPENAI_API_KEY` is set, embeddings use `text-embedding-3-small`; otherwise a local
deterministic vector store is used. Provider + model for chat/eval are selectable in
**Admin → Settings** (Anthropic / OpenAI / mock).

## Source of truth — `./content/`

```
content/knowledge/   Knowledge Base (company facts: pricing, MOQ, shipping, policies)
content/training/    Agent training manual
content/qa/          Real customer Q&A (questions.json → scenarios + grounding)
```

`npm run ingest` (or Admin → Content → upload / re-ingest) parses PDF/DOCX/XLSX/TXT/MD/JSON,
chunks, embeds, and stores everything. The same chunks ground the customer simulator, the
evaluator, and quiz generation — the app never grades against invented facts.

## The rubric (Admin-configurable weights)

accuracy 30 · completeness 20 · tone 15 · policy 15 · language 10 · sales 10 →
weighted overall per reply, plus per-dimension rationale, violations list, and an ideal reply.

**Readiness** = rolling average of overall across the last N graded turns (default 20).
READY when readiness ≥ 85 AND accuracy ≥ 90 AND 0 policy violations in the window —
all thresholds in Admin → Settings, applied immediately. Admin can agree/override any score
in Reply Review.

## Layout

```
server/            Express API (JWT auth, role guards)
  ingest.js        content parsing → chunks → embeddings → scenarios
  llm.js           provider layer (Anthropic / OpenAI / mock) + JSON-schema output
  services/        evaluator, customer simulator, quiz generator, readiness
client/            React 18 + Vite + Tailwind 4 + Recharts
content/           uploaded source-of-truth files
data/app.db        SQLite (gitignored)
```
