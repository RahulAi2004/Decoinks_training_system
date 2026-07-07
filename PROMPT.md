# BUILD PROMPT — "Decoinks Intern Trainer & Evaluation Portal"

You are an expert full-stack engineer. Build a production-ready web app that trains new sales
interns to chat with customers **exactly like a real Decoinks agent**, lets them practise against
AI-simulated customers, **auto-evaluates every reply**, and gives an admin the metrics to decide
whether an intern is **ready or not**.

Decoinks is a custom apparel + DTF (Direct-to-Film) transfer print shop. Interns will handle real
customer chats (Facebook Messenger / Instagram / WhatsApp) after training.

---

## BUILDING THIS WITH CLAUDE CODE — READ FIRST
- This is a **new project built from scratch** in the current empty folder. Scaffold everything
  (frontend, backend, DB schema, migrations, seed, README).
- The source-of-truth files are already in this repo under **`./content/`**:
    `./content/knowledge/`  → the Knowledge Base (company facts)
    `./content/training/`   → the Training Material (agent manual)
    `./content/qa/`         → the real Q&A (questions + best replies)
  **Read these files directly from disk** (they are .docx/.xlsx/.txt/.md). Build an **ingest script**
  (`npm run ingest`) that parses everything in `./content/`, chunks it, embeds it, and stores it —
  so the Admin can also re-upload/replace files later through the UI, which drops them into `./content/`
  and re-runs ingest.
- Put all secrets in **`.env`** (never commit it): `DATABASE_URL`, `OPENAI_API_KEY` and/or
  `ANTHROPIC_API_KEY`, `JWT_SECRET`. Add a `.env.example`. If a Postgres/pgvector instance isn't
  available, fall back to a local SQLite + a simple vector store so it runs out-of-the-box, but keep
  the code portable to Postgres+pgvector.
- Build **incrementally and verify**: scaffold → auth → content ingest → intern practice + evaluator
  → admin metrics → readiness. Run it and fix errors as you go. Provide clear run steps in the README
  (`npm install`, set `.env`, `npm run ingest`, `npm run dev`).
- Seed a demo **admin** account and one demo **intern** so I can log in immediately.

---

## 0. THE SOURCE OF TRUTH (uploaded content)
Everything the app teaches and grades against MUST come from the files in **`./content/`** — the app
must NOT invent facts:
- **Knowledge Base** (`./content/knowledge/`) — products, pricing, MOQ, turnaround, shipping, payment, policies.
- **Training Material** (`./content/training/`) — the agent training manual / modules.
- **Real Q&A** (`./content/qa/`) — real customer questions grouped by intent + the "best agent reply" for each.
Accept PDF, Word (.docx), Excel (.xlsx), and .txt/.md. Parse, chunk, embed, and use them as (a) the
intern's study content, (b) grounding for the customer simulator, and (c) the reference standard for
the evaluator. The Admin can replace these later via the Content page (writes to `./content/` + re-ingests).

---

## 1. USERS & ROLES
- **Admin** — uploads content, manages interns, sees all activity/metrics, sets thresholds, decides readiness.
- **Intern** — studies, practises, takes quizzes/scenarios, sees own progress.
Email + password auth (bcrypt), JWT sessions, role-based access. Admin can invite interns by email.

---

## 2. INTERN EXPERIENCE (pages)
1. **Home / Onboarding** — progress bar, "readiness %", next recommended activity.
2. **Study** — browse the uploaded Knowledge Base & Training Modules (searchable, clean reader).
3. **Practice Chat (core feature)** — the AI role-plays a realistic Decoinks CUSTOMER using a chosen
   or random **persona**. The intern chats to handle the customer like a real agent. After EACH intern
   reply, run the evaluator silently; at the end of the session show a scorecard + the "ideal reply"
   for the weakest turns. Personas to include (make configurable):
   - Price shopper ("how much?"), Bulk buyer / reseller, Church/team group order, Rush deadline,
     Spanish-speaking customer, Indecisive customer, Artwork-not-ready, Complaint / wrong item,
     Comparison shopper ("someone quoted me cheaper"), First-time small order.
4. **Scenarios** — a real customer question is shown; intern writes the best reply; the evaluator
   compares it to the model "best reply" from the uploaded Q&A and scores it with feedback.
5. **Quiz** — MCQ + short-answer generated from the Knowledge Base facts (MOQ, pricing, turnaround,
   shipping, payment, what-we-don't-offer). Auto-graded.
6. **My Progress** — scores over time, per-dimension breakdown, weak areas, readiness %, badges.

Every reply/session must give **immediate, specific feedback** ("You quoted a price without asking for
size — always get design + size + quantity first") plus the ideal reply.

---

## 3. ADMIN EXPERIENCE (pages)
1. **Content** — upload/replace Knowledge Base, Training Material, Q&A; see parsed status.
2. **Interns** — list, invite, activate/deactivate; per-intern summary card (readiness %, last active).
3. **Intern Detail** — full activity: every practice session, scenario, quiz, with transcripts and
   per-turn scores; trend charts; weak areas; policy-violation log.
4. **Reply Review** — a feed of intern replies with: the customer message, the intern's reply, the
   AI evaluator's per-dimension scores + rationale, and the ideal reply. Admin can agree/override a score.
5. **Metrics Dashboard** — org-wide + per-intern (see §5). Leaderboard / comparison.
6. **Readiness** — for each intern a clear **READY / NOT READY** verdict with the reasons and the
   thresholds used. Admin can override.
7. **Settings** — scoring weights, passing thresholds, personas, quiz config.

---

## 4. THE EVALUATION RUBRIC (the heart of the app)
For every intern reply, an LLM **evaluator** receives: the conversation so far, the intern's reply,
the retrieved relevant Knowledge-Base facts, and (for scenarios) the model best-reply. It returns a
JSON score 0–100 for EACH dimension, a short rationale per dimension, an overall score, a list of
any violations, and an "ideal_reply". Dimensions and default weights:

1. **Accuracy (30%)** — every fact matches the Knowledge Base (prices, MOQ, turnaround, policies).
   A wrong/invented fact is a hard fail on this dimension.
2. **Completeness (20%)** — gathered what's needed (design + size + quantity; address for shipping)
   and actually answered the question.
3. **Tone (15%)** — warm, human, concise (1–3 sentences), not robotic; appropriate emoji use.
4. **Policy compliance (15%)** — no invented prices/dates; no free physical samples (mockups only);
   payment details only after quote approval; honest about what we don't offer. Track violations.
5. **Language match (10%)** — replied in the customer's language (e.g. Spanish → Spanish).
6. **Sales effectiveness (10%)** — moved the sale forward with a clear next step / closing question.

`overall = Σ(dimension × weight)`. Weights are admin-configurable and must re-normalise to 100%.

**Grounding is mandatory:** retrieve the top relevant KB chunks and pass them to BOTH the customer
simulator and the evaluator, so scoring is based on OUR facts, not the model's imagination.

---

## 5. METRICS (admin must be able to see)
Per intern (and org averages):
- **Readiness score** (0–100) = rolling average of `overall` across the last N graded turns (default N=20),
  plus a **READY / NOT READY** flag (default: Ready when readiness ≥ 85 AND accuracy ≥ 90 AND
  policy_violations in last 20 turns = 0). All thresholds configurable.
- **Per-dimension averages** (accuracy, completeness, tone, policy, language, sales).
- **Improvement trend** — score over time (line chart); is it going up?
- **Volume** — sessions, scenarios, quizzes completed; total graded replies.
- **Quiz pass rate** and average.
- **Policy-violation count** (invented price, offered free sample, quoted before qualifying, etc.).
- **Weak areas** — which intents/objections/personas they score lowest on (so training can target them).
- **Response stats** — avg reply length, avg turns to close a practice order.
- **Leaderboard** — rank interns by readiness.

---

## 6. AI COMPONENTS
- **Customer simulator**: LLM prompted with a persona + retrieved KB context → role-plays a realistic
  Decoinks customer (stays in character, has a goal, reacts to the intern, may object/negotiate).
- **Evaluator**: LLM given the rubric + KB context + intern reply → returns the JSON scorecard above.
  Use structured output / JSON schema so scores are reliable.
- **Scenario grader**: compares intern reply to the model best-reply + KB → score + feedback.
- **Quiz generator**: creates MCQ/short-answer from KB facts; grades short answers with the LLM.
- Use **RAG** (embeddings over the uploaded files) for all grounding. Make the LLM provider swappable
  (OpenAI and Anthropic/Claude), model selectable in settings.

---

## 7. DATA MODEL (PostgreSQL, UUID PKs, created_at/updated_at)
- `users` (id, name, email, password_hash, role[admin|intern], is_active, last_login)
- `documents` (id, kind[knowledge|training|qa], filename, storage_path, parsed_status, uploaded_by)
- `doc_chunks` (id, document_id, content, embedding vector) — for RAG
- `personas` (id, name, description, difficulty, prompt)
- `practice_sessions` (id, intern_id, persona_id, status, started_at, ended_at, overall_score)
- `session_messages` (id, session_id, role[customer|intern], body, created_at)
- `evaluations` (id, session_message_id NULL, scenario_attempt_id NULL, accuracy, completeness, tone,
  policy, language, sales, overall, rationale JSONB, violations JSONB, ideal_reply, evaluator_model)
- `scenarios` (id, question, model_reply, intent, source_document_id)
- `scenario_attempts` (id, intern_id, scenario_id, reply, overall_score, created_at)
- `quizzes` (id, question, type[mcq|short], options JSONB, correct_answer, source)
- `quiz_attempts` (id, intern_id, quiz_id, answer, is_correct, score, created_at)
- `readiness_snapshots` (id, intern_id, readiness_score, dimension_scores JSONB, is_ready, computed_at)
- `settings` (key, value) — weights, thresholds, active LLM/model, N window.

---

## 8. TECH STACK & QUALITY
- **Frontend**: React + Vite + Tailwind + Recharts (for the metric charts). Clean, modern, responsive.
- **Backend**: Node.js + Express (or Next.js API). PostgreSQL. pgvector (or a vector store) for RAG.
- **File parsing**: PDF, DOCX, XLSX, TXT/MD → text → chunk → embed.
- **Auth**: JWT + bcrypt, role-based route guards.
- **LLM**: provider-agnostic layer (OpenAI + Anthropic), JSON-schema structured output for evaluation.
- Seed with a demo admin. Include a script to (re)ingest uploaded files.
- Handle errors gracefully; never crash on a bad file or a slow LLM call (show status, retry).

---

## 9. ACCEPTANCE CRITERIA (must all work)
1. Admin uploads the 3 files → they are parsed, chunked, embedded, and shown as "ready".
2. Intern opens Practice Chat → AI plays a persona → intern replies → each reply is scored on the 6
   dimensions with feedback + an ideal reply, grounded ONLY in the uploaded content.
3. Intern does scenarios and quizzes; all auto-graded.
4. Intern's "My Progress" shows scores, trend, weak areas, readiness %.
5. Admin sees every intern's activity, transcripts, per-dimension metrics, trend charts, policy
   violations, and a READY / NOT READY verdict with reasons; can review/override individual scores.
6. Scoring weights and readiness thresholds are configurable in Settings and take effect immediately.
7. Nothing is graded against invented facts — every judgement cites the uploaded knowledge base.

Build it clean, well-structured, and easy to extend. Ask me for the uploaded files when you're ready
to ingest them.
