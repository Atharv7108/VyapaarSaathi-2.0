# VyapaarSaathi

> **Bolo, aur hisaab ho jaye.**
> Speak naturally. Your business records itself.

VyapaarSaathi is a voice-first bookkeeping and business assistant for Indian
street vendors and small businesses. A vendor can send a WhatsApp voice note
or text message in Hindi, Marathi, Hinglish, or English. The system understands
the message, converts it into structured business data, updates the ledger and
inventory, handles udhari, and replies with a clear confirmation.

The project also includes a web dashboard for reviewing the business and an
explainable Business Autopilot that sends a vendor-specific morning plan on
WhatsApp.

This document is written both as a developer guide and as a presentation
guide. The sections titled **How to explain it** can be used directly during
a project demonstration.

---

## Table of Contents

1. [The problem](#the-problem)
2. [The solution in one minute](#the-solution-in-one-minute)
3. [Current architecture](#current-architecture)
4. [How audio is processed](#how-audio-is-processed)
5. [How text is processed](#how-text-is-processed)
6. [The complete WhatsApp flow](#the-complete-whatsapp-flow)
7. [Intent and data extraction](#intent-and-data-extraction)
8. [Conversation engine and follow-up questions](#conversation-engine-and-follow-up-questions)
9. [Ledger and inventory behavior](#ledger-and-inventory-behavior)
10. [Udhari flow](#udhari-flow)
11. [Business Autopilot morning alert](#business-autopilot-morning-alert)
12. [Web dashboard](#web-dashboard)
13. [AI insights and reports](#ai-insights-and-reports)
14. [Security and vendor isolation](#security-and-vendor-isolation)
15. [Deployment architecture](#deployment-architecture)
16. [API reference](#api-reference)
17. [Technology stack](#technology-stack)
18. [Local development](#local-development)
19. [Environment variables](#environment-variables)
20. [Project structure](#project-structure)
21. [Presentation walkthrough](#presentation-walkthrough)
22. [Known limitations and next steps](#known-limitations-and-next-steps)

---

## The problem

Many small vendors:

- Do not have time to maintain a spreadsheet.
- Prefer speaking over typing.
- Mix Hindi, Marathi, Hinglish, and English in one sentence.
- Need to remember sales, expenses, stock, and customer credit at the same time.
- Often do not know their actual profit or which item needs attention.

Traditional bookkeeping software asks the vendor to understand forms,
categories, and accounting terminology. VyapaarSaathi reverses that model:
the vendor speaks naturally and the application performs the bookkeeping work.

---

## The solution in one minute

Example message:

> "Aaj 30 samosa bike, 600 rupaye aaye, aur doodh par 200 kharch hua."

VyapaarSaathi:

1. Receives the voice note through WhatsApp.
2. Downloads and converts the audio.
3. Transcribes speech into text using Groq Whisper.
4. Sends the transcript to an LLM for structured extraction.
5. Detects two business actions: a sale and an expense.
6. Validates the result and checks the vendor's inventory.
7. Saves the entries to the vendor's ledger.
8. Deducts sold quantity from inventory when applicable.
9. Replies with what was recorded and the current result.

The same processing path is used for a typed WhatsApp message. Voice and text
are two input formats; the bookkeeping logic after transcription is shared.

---

## Current architecture

```text
                         +----------------------+
                         | Vendor                |
                         | WhatsApp voice/text   |
                         +-----------+----------+
                                     |
                                     v
                         +----------------------+
                         | Meta WhatsApp Cloud   |
                         | API webhook           |
                         +-----------+----------+
                                     |
                                     v
+------------------------------------------------------------------+
| FastAPI backend                                                  |
|                                                                  |
| main.py                                                          |
| - webhook routing                                                |
| - dashboard REST endpoints                                       |
| - admin endpoints                                                 |
| - application startup and scheduler lifecycle                    |
|                                                                  |
| services/voice_ledger.py                                         |
| - audio download and conversion                                 |
| - Groq Whisper transcription                                     |
| - LLM extraction and validation                                  |
| - shared transcript processing                                   |
| - ledger and WhatsApp replies                                   |
|                                                                  |
| services/conversation_engine.py                                 |
| - missing-information detection                                  |
| - follow-up questions                                            |
| - multi-turn pending state                                       |
|                                                                  |
| services/inventory.py, services/udhari.py                       |
| - stock, catalog, and customer-credit operations                 |
+----------------------------+-------------------------------------+
                             |
               +-------------+-------------+
               |                           |
               v                           v
      +------------------+       +----------------------+
      | Groq APIs        |       | MongoDB               |
      | Whisper: STT     |       | vendors               |
      | LLM: extraction  |       | ledger                |
      +------------------+       | inventory             |
                                 | udhari                |
                                 | autopilot_deliveries |
                                 +----------------------+

                         +----------------------+
                         | React + Vite dashboard|
                         | Render or local       |
                         +-----------+----------+
                                     |
                                     v
                         FastAPI REST API

                         +----------------------+
                         | APScheduler           |
                         | 09:00 IST morning plan|
                         +----------------------+
```

### Main architectural idea

The backend is the source of truth. WhatsApp and the dashboard are clients of
the same backend services. This prevents a sale recorded from the dashboard
from behaving differently from a sale spoken on WhatsApp.

The application is intentionally not a collection of independent AI features.
The AI is used at the language boundary; deterministic Python services validate
and apply the resulting business actions.

---

## How audio is processed

The audio pipeline is implemented mainly in
[services/voice_ledger.py](services/voice_ledger.py).

### Stage 1: WhatsApp receives the voice note

The vendor records a voice note and sends it to the business WhatsApp number.
Meta sends an inbound webhook event to:

```text
POST /webhook
```

The webhook identifies the sender and the media object. The sender phone
number becomes the vendor scope for all later database operations.

### Stage 2: The backend downloads the media

The backend uses the WhatsApp Graph API credentials from the environment to
download the audio file. It does not trust a client-provided vendor ID to
choose whose data will be modified; the WhatsApp sender is the identity used
for the operation.

### Stage 3: Audio conversion

WhatsApp audio can arrive in formats such as OGG/Opus. FFmpeg is used when
conversion is required. The goal is to provide Whisper with a predictable
audio input rather than relying on the original container or codec.

### Stage 4: Speech-to-text

The converted audio is sent to the configured Groq Whisper model, normally:

```text
whisper-large-v3-turbo
```

The language is configured as `auto` by default so Hindi, Marathi, English,
and Hinglish can be handled without forcing every vendor into one language.
The result is a plain transcript.

Example:

```text
Aaj 30 samosa beche aur 600 rupaye mile
```

### Stage 5: Structured extraction

The transcript is sent to the configured Groq LLM. The model is asked to
return structured JSON, not a conversational answer. The JSON can contain one
or multiple entries because one sentence can contain multiple actions.

Example:

```json
{
  "entries": [
    {
      "intent": "ADD_ENTRY",
      "type": "income",
      "category": "samosa",
      "quantity": 30,
      "amount": 600,
      "description": "30 samosa sold"
    }
  ]
}
```

### Stage 6: Validation and business rules

Pydantic validation and deterministic code run after the LLM. This is
important: the model suggests structured data, but it does not directly write
to the database.

Examples of safeguards:

- Selling words such as "becha", "beche", and "sell" are treated as income.
- Missing amounts are not invented.
- A `DELETE_ITEM` action requires a specific item name.
- Udhari actions require a customer and a valid amount where appropriate.
- Stock and price updates require valid positive values.
- Vendor scope is applied before database writes.

### Stage 7: Shared transcript processing

The transcript is passed to `process_transcript_message()`. This function is
shared by voice messages and text messages. From this point, both channels
use the same extraction, follow-up, inventory, ledger, and reply behavior.

### Stage 8: Response

The backend sends a confirmation back to WhatsApp. If information is missing,
it asks a follow-up question instead of saving an unreliable transaction.

### How to explain it

> "We use AI only to understand the vendor's language. After understanding,
> deterministic business rules validate the result before anything is saved.
> This gives us the flexibility of AI and the safety of normal application
> logic."

---

## How text is processed

Text messages do not need the audio stages.

```text
WhatsApp text
    |
    v
Webhook identifies sender and text
    |
    v
process_transcript_message(sender, text)
    |
    v
Same extraction, validation, conversation, database, and reply pipeline
```

This allows messages such as:

```text
20 samosa beche 400 mile
samosa ka stock 20 aur add karo
Ramesh ne 500 udhari wapas ki
inventory se chai delete karo
```

The system supports both voice and text without maintaining two separate
bookkeeping implementations.

---

## The complete WhatsApp flow

```text
1. Vendor sends voice or text
          |
2. Meta sends webhook to FastAPI
          |
3. Backend identifies the vendor by WhatsApp phone
          |
4. Voice? Download -> convert -> Whisper transcript
   Text? Use text directly
          |
5. LLM extracts one or more structured intents
          |
6. Pydantic and deterministic validation
          |
7. Conversation engine checks completeness
          |
8. If incomplete: save pending state and ask a question
   If complete: apply ledger/inventory/udhari operation
          |
9. Build a human-readable response
          |
10. Send response through WhatsApp Graph API
```

### Multiple actions in one message

The extractor can return multiple entries. For example:

```text
20 samosa beche, 400 rupaye aaye, doodh par 100 kharch kiya
```

becomes:

1. Income for the samosa sale.
2. Expense for milk.

The application processes each validated entry while aggregating the final
reply.

---

## Intent and data extraction

The current extraction model supports these intents:

| Intent | Meaning |
|---|---|
| `ADD_ENTRY` | Record income or expense |
| `STOCK_UPDATE` | Add or update stock |
| `PRICE_UPDATE` | Change an item's price |
| `GET_REPORT` | Request a profit and loss report |
| `GET_INVENTORY` | Request the current inventory |
| `DELETE_ITEM` | Soft-delete one named inventory item |
| `UDHARI_ADD` | Add customer credit |
| `UDHARI_PAYMENT` | Record a customer payment |
| `UDHARI_QUERY` | Ask about one customer's balance |
| `UDHARI_REPORT` | Request the udhari report |

For a normal ledger entry, the important fields are:

```text
intent, type, category, quantity, amount, description
```

The system keeps the raw business meaning separate from presentation. The
dashboard and WhatsApp response can change without changing the stored ledger
record.

---

## Conversation engine and follow-up questions

The conversation engine in
[services/conversation_engine.py](services/conversation_engine.py) prevents
the system from saving incomplete transactions.

### Example

Vendor:

```text
Aaj samosa beche
```

The system may not know the quantity or amount. Instead of guessing, it
creates a pending conversation:

```text
You sold samosa. How many did you sell?
```

The vendor answers with a second voice or text message. The answer is merged
with the pending entry, validated again, and then saved.

### Why this matters

Without the conversation engine, an AI model might invent an amount or save a
zero-value transaction. Asking one short question is safer than recording
incorrect financial data.

### Conversation states

The onboarding and interaction states include:

- New vendor
- Awaiting consent
- Awaiting name
- Awaiting business category
- Awaiting business name
- Active vendor
- Pending transaction follow-up

Pending transaction state is currently process-memory based. A production
deployment should use a shared persistent store if multiple backend instances
are introduced.

---

## Ledger and inventory behavior

### Ledger

Ledger records are stored in MongoDB and are scoped by vendor phone variants.
An entry contains the business event, amount, type, category, quantity, and
timestamps needed for reports and trends.

Income and expense are kept separate:

```text
net result = total income - total expenses
```

### Inventory

Inventory is managed by [services/inventory.py](services/inventory.py).
Important fields include:

- `item_name`
- `daily_stock`
- `current_stock`
- `price_per_unit`
- `unit`
- `stock_date`
- `is_active`

### Stock operations

| Operation | Example | Result |
|---|---|---|
| Create/set | "Aaj 50 samosa banaye" | Creates item and stock |
| Restock | "20 samosa aur add karo" | Increases current stock |
| Catalog update | Dashboard edit | Changes planned daily stock |
| Sale deduction | "10 samosa beche" | Decreases current stock |
| Soft delete | "samosa inventory se delete karo" | Sets `is_active=false` |

Deleting an inventory item is intentionally a soft delete. Historical ledger
records remain available for reports.

An ambiguous command such as "inventory delete karo" is rejected because the
application requires a specific item name.

### Daily stock

Inventory can be reset for a new business day through the daily stock reset
logic. The system keeps the vendor's catalog and daily availability separate
from historical sales.

---

## Udhari flow

Udhari means customer credit or money owed.

Examples:

```text
Ramesh ko 500 udhari diya
Ramesh ne 200 wapas kiye
Ramesh ka udhari kitna hai?
```

The system:

1. Identifies the customer.
2. Records credit or payment.
3. Calculates outstanding balance.
4. Uses the balance and age in reports and Autopilot recommendations.

Udhari is stored separately from normal income and expense so that a payment
does not get confused with a new sale.

---

## Business Autopilot morning alert

Business Autopilot is an explainable recommendation engine in
[services/autopilot.py](services/autopilot.py). It is deliberately
deterministic. It does not place orders or automatically contact a customer's
phone.

### Data used

For each vendor, it reads:

- The last 14 days of ledger activity.
- Current inventory.
- Outstanding udhari.
- Recent item quantities.

### Recommendations

It can produce up to five prioritized actions:

1. Restock an item with low or zero stock.
2. Follow up on old or large outstanding udhari.
3. Record today's business if there is recent history but no entry today.
4. Review costs when the recent average net result is negative.
5. Keep the strongest tracked item ready based on recent quantities.

Each recommendation includes:

- Priority: high, medium, or low.
- Human-readable message.
- Reason based on actual vendor data.
- Supporting data.
- Dashboard action link.

### WhatsApp delivery

The scheduler uses APScheduler with the `Asia/Kolkata` timezone. The current
default configuration is:

```env
ENABLE_DAILY_AUTOPILOT=true
DAILY_AUTOPILOT_HOUR=9
DAILY_AUTOPILOT_MINUTE=0
```

At 09:00 IST, while the backend is running:

1. Active WhatsApp vendors are selected.
2. A fresh plan is generated separately for each vendor.
3. The plan is formatted as a WhatsApp message.
4. The message is sent through the WhatsApp Graph API.
5. A record is stored in `autopilot_deliveries`.

The delivery record prevents duplicate automatic delivery to the same vendor
on the same date. If the server is offline at 09:00, the current scheduler
does not automatically catch up later.

### Admin testing and broadcast

The admin dashboard has a **Morning Plan** broadcast mode. This is different
from a normal typed broadcast:

- Normal broadcast: sends the same manually typed message to recipients.
- Morning Plan: generates each recipient's real vendor-specific plan and uses
  the same formatter and sender as the automatic morning job.

Relevant endpoints:

```text
GET  /autopilot?phone=<phone>
GET  /autopilot/preview?phone=<phone>
POST /admin/autopilot/send-now
POST /admin/autopilot/broadcast
```

The admin endpoints require a valid admin JWT. Delivery responses include
sent recipients and per-recipient failure reasons.

### Example morning message

```text
🌅 VyapaarSaathi — Aaj ka Business Plan

1. Restock samosa
samosa has 8 pieces left. Prepare about 42 more.
💡 Kyun: Current stock is 8/50 of today's target.

2. Follow up with Ramesh
Ramesh has ₹2,000 outstanding.
💡 Kyun: The balance has been open for 12 days.

Dashboard par detail dekhne ke liye VyapaarSaathi kholein.
```

If there is no urgent recommendation, the vendor receives a positive
no-action message instead of an empty response.

---

## Web dashboard

The frontend is in [frontend/src](frontend/src) and uses React, TypeScript,
Vite, Tailwind-style utility classes, and Zustand.

### Main screens

| Screen | Purpose |
|---|---|
| Home | Today's result, key metrics, recent activity, and Business Plan |
| Ledger | Review and manage income and expenses |
| Record | Record voice entries and answer follow-up questions |
| Inventory | View stock, prices, and catalog items |
| Udhari | Manage customer credit and payments |
| Insights | View analytics and narrated business insights |
| Profile | Vendor settings and language |
| Admin | Vendor management, system statistics, and broadcast tools |

The Business Plan is intentionally shown at the bottom of the vendor dashboard.
WhatsApp is the primary morning delivery channel; the dashboard is the
secondary place to review details.

### Language support

The shared language state supports:

```text
English, Hindi, Marathi, Hinglish
```

The landing page, dashboard layout, onboarding, and profile use the same
persisted language preference.

### Frontend API behavior

During local development, Vite proxies API paths to
`http://127.0.0.1:8000`. In a separate deployment, set:

```env
VITE_API_URL=https://your-backend-domain.example
```

Only public API URLs belong in Vite variables. Never expose API tokens or
database credentials in frontend environment variables.

---

## AI insights and reports

The project has two different AI patterns:

### 1. Transaction understanding

Groq Whisper and the configured Groq LLM translate a vendor's voice or text
into safe structured actions.

### 2. Business analysis

The insights service aggregates ledger data and can produce:

- Revenue and expense totals.
- Net result and margin.
- Category performance.
- Recent trends.
- Average daily revenue.
- Business health indicators.
- Explanations and recommendations.

Reports can be generated as PDF files through the report endpoint.

The key design principle is that analytics read vendor data; they do not
silently modify the ledger.

---

## Security and vendor isolation

Security is especially important because one application serves multiple
vendors.

### Vendor scope

- WhatsApp requests are scoped from the sender phone number.
- Database queries use normalized phone variants.
- Inventory, ledger, and udhari operations use the current vendor scope.
- Autopilot builds a separate plan for each vendor.

### Admin security

Admin endpoints use JWT authentication and require the `admin` role. Examples
include vendor management, statistics, uploads, and broadcast operations.

### Secrets

Secrets are loaded from `.env` and are not committed to the repository:

- WhatsApp access token.
- WhatsApp phone number ID.
- Groq API key.
- MongoDB URI.
- JWT secret and related auth settings.

The `.env.example` file documents variable names and safe defaults only.

### Safe AI boundary

The LLM is not trusted as a database writer. Its output is:

```text
LLM output -> schema validation -> business rules -> database operation
```

This design makes errors visible and limits the effect of hallucinated fields.

---

## Deployment architecture

### Development

```text
Mac or developer machine
  ├── FastAPI on port 8000
  ├── Vite on port 5173
  └── Cloudflare tunnel for local webhook testing
```

### Current production deployment: Render + Docker

The current deployment is a single Docker-based Render web service. The
frontend is not deployed separately to Vercel. The repository's
[Dockerfile](Dockerfile) builds the React/Vite frontend first and then places
the compiled `web/` files inside the Python runtime image. FastAPI serves the
dashboard and the API from the same Render service.

```text
Render web service
  └── Docker container
      ├── React/Vite production dashboard
      ├── FastAPI REST API
      ├── Meta WhatsApp webhook
      └── APScheduler at 09:00 IST

MongoDB provider
  └── Persistent application data
```

The file [render.yaml](render.yaml) describes the Render service, Docker
runtime, health check, and non-secret default environment variables. Render
provides the public HTTPS URL used for the Meta WhatsApp webhook.

#### How the Docker deployment works

The Dockerfile uses two stages:

1. **Frontend builder:** Node 20 installs the npm dependencies and runs
   `npm run build`.
2. **Backend runtime:** Python 3.11 installs the Python requirements and FFmpeg,
   copies the application, and copies the built frontend into `/app/web`.

The container starts with:

```bash
uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Render supplies the `PORT` value. The container must listen on `0.0.0.0`, not
only on `127.0.0.1`, so Render can route public requests to it.

#### Render deployment steps

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** or **New → Web Service**.
3. Select the GitHub repository `Atharv7108/VyapaarSaathi-2.0`.
4. If using the blueprint, Render reads [render.yaml](render.yaml). If creating
   the service manually, choose **Docker** as the runtime.
5. Set the health check path to:

   ```text
   /health
   ```

6. Add the secret environment variables in Render's Environment page:

   ```text
   MONGODB_URI
   GROQ_API_KEY
   WHATSAPP_API_TOKEN
   WHATSAPP_PHONE_NUMBER_ID
   WHATSAPP_BUSINESS_ACCOUNT_ID
   WHATSAPP_WEBHOOK_VERIFY_TOKEN
   ```

7. Confirm the scheduler values:

   ```text
   ENABLE_DAILY_AUTOPILOT=true
   DAILY_AUTOPILOT_HOUR=9
   DAILY_AUTOPILOT_MINUTE=0
   ```

8. Deploy and open:

   ```text
   https://your-service.onrender.com/health
   ```

9. Confirm the response contains `"status": "ok"` and an empty
   `missing_env` list.
10. Configure Meta WhatsApp's callback URL as:

    ```text
    https://your-service.onrender.com/webhook
    ```

11. Use the same webhook verification token in Meta and Render.
12. Check Render logs for:

    ```text
    Daily Autopilot scheduler enabled (09:00 IST).
    ```

#### Render free-tier scheduling note

The daily scheduler lives inside the FastAPI process. It can send at 09:00
only while that process is running. Render free web services can spin down
after inactivity and may restart. Therefore, the Render free tier is suitable
for a demo or low-traffic prototype, but it is not an absolute 24-hour uptime
guarantee. A scheduled request or a paid always-on service is needed for
stronger delivery reliability.

If Render is asleep at 09:00, the current scheduler does not automatically
catch up later. The delivery record prevents duplicates after a successful
send, but a missed run remains missed.

#### Docker commands for local verification

Build the same image used by Render:

```bash
docker build -t vyapaarsaathi .
```

Run it with the private environment file:

```bash
docker run --rm --env-file .env -p 8000:8000 vyapaarsaathi
```

Check the container:

```bash
curl http://127.0.0.1:8000/health
```

The `.dockerignore` file excludes `.env`, virtual environments, tests, and
build caches from the image context. Never bake secrets into the Dockerfile or
commit `.env`.

Aiven can provide managed databases and infrastructure services, but it does
not host this FastAPI process as a free application server. The current code
uses MongoDB, so moving to an Aiven PostgreSQL service would require a
database-layer migration.

### Other hosting options

An always-on VM can provide stronger scheduler reliability, but the current
repository is prepared for Render's Docker deployment. Do not use the local
`start.sh` script or `uvicorn --reload` as the production process on Render.

---

## API reference

### Public and vendor endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health status and missing environment check |
| `POST` | `/webhook` | Receive WhatsApp events |
| `GET` | `/webhook` | Verify the WhatsApp webhook |
| `POST` | `/record` | Process a web voice recording |
| `POST` | `/record/answer` | Process a follow-up recording |
| `POST` | `/record/cancel` | Cancel a pending conversation |
| `GET` | `/entries` | Read vendor ledger entries |
| `GET` | `/inventory` | Read vendor inventory |
| `POST` | `/inventory` | Create or update an item |
| `DELETE` | `/inventory/{item}` | Soft-delete an item |
| `GET` | `/udhari` | Read udhari data |
| `GET` | `/autopilot` | Read a vendor's Business Plan |
| `GET` | `/autopilot/preview` | Preview the exact WhatsApp plan text |
| `GET` | `/ai-insights` | Read business analytics |
| `GET` | `/api/report` | Generate a business report |

### Protected admin endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/stats` | Platform or vendor statistics |
| `GET` | `/admin/vendors` | List vendors |
| `GET` | `/admin/vendors/{phone}/details` | Read vendor details |
| `POST` | `/admin/broadcast` | Send a normal typed/media broadcast |
| `POST` | `/admin/autopilot/send-now` | Send today's plan to eligible vendors |
| `POST` | `/admin/autopilot/broadcast` | Send generated plans to a chosen audience |
| `POST` | `/admin/upload-media` | Upload broadcast media |
| `GET` | `/admin/audit-logs` | Read admin activity |

### Important response states

The recording API can return:

```json
{
  "status": "complete",
  "transcript": "aaj 20 samosa beche",
  "data": {
    "total_earned": 400,
    "total_spent": 0
  }
}
```

or a pending follow-up:

```json
{
  "status": "pending",
  "pending_reason": "NEEDS_QUANTITY",
  "pending_category": "samosa",
  "counter_question_hi": "आपने samosa बेचे - कितने?",
  "counter_question_en": "You sold samosa - how many?"
}
```

---

## Technology stack

| Layer | Technology | Role |
|---|---|---|
| API | FastAPI | REST API and WhatsApp webhook |
| Language | Python | Business logic and integrations |
| Frontend | React + TypeScript | Vendor and admin dashboard |
| Build | Vite | Frontend development and production build |
| State | Zustand | Frontend state and API-backed workflow state |
| Database | MongoDB | Vendors, ledger, inventory, udhari, delivery records |
| Speech-to-text | Groq Whisper | Voice transcription |
| Language understanding | Groq LLM | Intent and field extraction |
| Text-to-speech | gTTS where used | Spoken insight/follow-up audio |
| Messaging | Meta WhatsApp Cloud API | Incoming/outgoing WhatsApp messages |
| Audio tools | FFmpeg | Audio conversion |
| PDF | ReportLab | Business report generation |
| Scheduler | APScheduler | Daily and periodic jobs |
| Local tunnel | Cloudflare Tunnel | Local webhook testing |

---

## Local development

### Prerequisites

- Python 3.9+ (the repository's current virtual environment uses Python 3.9)
- Node.js 18+
- FFmpeg
- MongoDB connection
- Meta WhatsApp Cloud API credentials
- Groq API key
- Cloudflared for local WhatsApp webhook testing

### Backend

```bash
git clone https://github.com/Atharv7108/VyapaarSaathi-2.0.git
cd VyapaarSaathi-2.0

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env with real values. Never commit .env.

uvicorn main:app --reload --port 8000
```

### Frontend

In a second terminal:

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The Vite proxy forwards API calls to port 8000.

### Local WhatsApp webhook

Start a public tunnel to the backend:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

Use the generated HTTPS URL in Meta's WhatsApp webhook configuration:

```text
https://your-tunnel.trycloudflare.com/webhook
```

For a stable production webhook, use a permanent backend domain and HTTPS
instead of a temporary tunnel.

### Run tests and build

```bash
PYTHONPATH=. pytest -q
python -m py_compile main.py scheduler.py services/*.py
npm run build
```

---

## Environment variables

The real `.env` is private. Use `.env.example` as the template.

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `WHATSAPP_API_TOKEN` | Yes | - | Meta WhatsApp access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | - | Meta WhatsApp sender ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | No | - | Meta business account ID |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Yes | - | Webhook verification secret |
| `GROQ_API_KEY` | Yes | - | Groq Whisper and LLM access |
| `MONGODB_URI` | Yes | - | MongoDB connection string |
| `MONGODB_DB_NAME` | No | `vyapaarsaathi` | MongoDB database name |
| `GROQ_LLM_MODEL` | No | configured model | Structured extraction model |
| `GROQ_WHISPER_MODEL` | No | `whisper-large-v3-turbo` | Speech-to-text model |
| `GROQ_WHISPER_LANGUAGE` | No | `auto` | Voice language mode |
| `FFMPEG_BINARY` | No | `ffmpeg` | FFmpeg executable |
| `ENABLE_DAILY_AUTOPILOT` | No | `true` | Enable morning plans |
| `DAILY_AUTOPILOT_HOUR` | No | `9` | Morning hour in IST |
| `DAILY_AUTOPILOT_MINUTE` | No | `0` | Morning minute |
| `ENABLE_INSTANT_STOCK_ALERTS` | No | `true` | Enable proactive stock alerts |
| `INSTANT_STOCK_ALERT_INTERVAL_SECONDS` | No | `60` | Stock-alert polling interval |
| `INSTANT_STOCK_ALERT_UNITS_THRESHOLD` | No | `20` | Low-stock threshold |
| `INSTANT_STOCK_ALERT_RECIPIENTS` | No | empty | Optional alert recipients |
| `ENABLE_WEEKLY_SUMMARY` | No | `false` | Enable weekly summary job |

### Scheduler confirmation

When the backend starts, look for:

```text
Daily Autopilot scheduler enabled (09:00 IST).
```

At delivery time, the backend reports sent, skipped, and failed vendors. A
server that is stopped at 09:00 can miss that run; an always-on deployment is
required for reliable automatic delivery.

---

## Project structure

```text
VyapaarSaathi/
├── main.py                         FastAPI app, webhook, REST, admin APIs
├── scheduler.py                    APScheduler registration and lifecycle
├── db_config.py                    MongoDB connection
├── requirements.txt                Python dependencies
├── .env.example                    Safe configuration template
├── services/
│   ├── autopilot.py                Plan generation and WhatsApp delivery
│   ├── voice_ledger.py             Audio, extraction, saving, replies
│   ├── conversation_engine.py      Follow-up and completeness logic
│   ├── inventory.py                Inventory and stock operations
│   ├── udhari.py                   Customer credit operations
│   ├── vendor_manager.py           Vendor identity and onboarding
│   ├── ai_insights.py              Analytics and insight generation
│   ├── report_generator.py         PDF report creation
│   ├── stock_suggestions.py         Stock suggestions
│   └── settings.py                 Environment configuration
├── frontend/
│   └── src/
│       ├── pages/                  Vendor and admin screens
│       ├── components/             Shared UI components
│       ├── store/useStore.ts       Zustand state and API calls
│       └── App.tsx                 Frontend routing
├── tests/                           Backend tests
├── static/                          Runtime/static files
├── start.sh                         Local multi-process launcher
└── vite.config.js                   Vite root, build, and API proxy
```

---

## Presentation walkthrough

The following is a simple five-minute demonstration.

### Slide 1: Problem

> "Small vendors do business in natural language, but bookkeeping tools expect
> forms and typing. This causes missing records, unknown profit, and forgotten
> customer credit."

### Slide 2: Product

Show the vendor sending:

```text
20 samosa beche, 400 mile
```

Explain that the same system accepts a WhatsApp voice note or text.

### Slide 3: AI pipeline

Use this sequence:

```text
Voice -> download -> FFmpeg -> Whisper -> transcript
      -> LLM JSON -> validation -> business rules -> MongoDB
      -> WhatsApp confirmation
```

Say:

> "The AI understands language, but deterministic code decides what is safe to
> save. That separation is our reliability layer."

### Slide 4: Conversation safety

Send an incomplete message such as:

```text
Aaj samosa beche
```

Show the follow-up question. Explain that the application asks instead of
inventing an amount or quantity.

### Slide 5: Business records

Open the dashboard and show:

- Ledger entry.
- Inventory deduction.
- Current profit.
- Udhari balance.

Explain that these are different views over vendor-scoped business data.

### Slide 6: Business Autopilot

Show the Business Plan at the bottom of the dashboard or use the WhatsApp
preview. Explain that it combines:

- 14 days of business activity.
- Current stock.
- Outstanding udhari.

Then show the automatic delivery configuration:

```text
09:00 IST every day
```

### Slide 7: Safety and operations

Mention:

- Vendor isolation by WhatsApp phone.
- Admin JWT protection.
- Soft deletion for inventory.
- Duplicate-delivery protection.
- Delivery failure reporting.
- Environment secrets kept outside source code.

### One-minute technical summary

> "VyapaarSaathi is a FastAPI backend with a React dashboard and MongoDB.
> WhatsApp is the primary input and delivery channel. Audio is transcribed by
> Groq Whisper, language is converted to structured intents by a Groq LLM, and
> deterministic Python services validate and save the result. The conversation
> engine asks follow-up questions when data is incomplete. Business Autopilot
> reads the last 14 days, inventory, and udhari to send an explainable,
> vendor-specific plan at 09:00 IST."

---

## Known limitations and next steps

### Current limitations

- The backend scheduler requires the server to be running at the scheduled
  time; missed runs do not currently catch up automatically.
- Pending conversation state is process-memory based and is not yet shared
  between multiple backend instances.
- Free hosting providers may sleep, restart, or limit outbound traffic.
- WhatsApp proactive messages may require Meta-approved templates outside the
  24-hour customer-service window.
- The frontend production bundle is large and can be code-split further.

### Recommended next steps

- Add a restart catch-up check for today's undelivered Autopilot message.
- Persist pending conversation state in MongoDB or Redis.
- Add a delivery status page with scheduler health and last-run time.
- Add approved WhatsApp templates for proactive messages outside the 24-hour
  window.
- Add role-based admin permissions beyond the current admin role.
- Split large frontend routes with dynamic imports.
- Add end-to-end tests against a mocked WhatsApp Graph API.

---

## Why this matters

VyapaarSaathi makes financial record keeping as natural as speaking to a
trusted assistant. It is designed for vendors who should not have to learn
accounting software before they can understand their own business.

> **Built for Bharat. Powered by voice, AI, and explainable business logic.**

*Last updated: October 2026*
