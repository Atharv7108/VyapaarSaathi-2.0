# WhatsApp Business API Migration Plan

## 1. Goal

Build a multi-vendor WhatsApp business system where many vendors can contact one business WhatsApp number, send voice messages, and receive text replies based on their own business context.

The system must support:
- vendor identification by phone number
- vendor-specific business context
- voice input -> transcription -> intent extraction
- inventory, sales, reports, and follow-up workflows
- text replies only

---

## 2. Recommended product direction

Do not build this as a single generic bot for everyone.

Build it as:
- one business number
- many vendor profiles
- one shared business engine
- vendor-aware actions and data

This is a multi-tenant business workflow, not just a chat bot.

---

## 3. Why not start from zero

The current project already has valuable business logic:
- inventory management
- ledger entry logic
- voice transcription pipeline
- AI extraction flow
- reporting and insights logic
- FastAPI backend structure

So the best approach is to keep this project and refactor the parts that are tied to Twilio and single-user behavior.

---

## 4. What to keep from the existing system

Keep these modules and concepts:

### Keep
- services/voice_ledger.py
  - audio download/conversion
  - transcription
  - intent extraction
  - ledger saving
  - reply generation

- services/conversation_engine.py
  - follow-up questions
  - pending conversation state
  - multi-turn business interaction

- services/inventory.py
  - inventory tracking
  - stock updates
  - daily stock logic

- services/ai_insights.py
  - reporting and insights logic

- main.py
  - FastAPI app structure
  - API routes
  - webhook concept

- Supabase storage model
  - ledger
  - inventory
  - existing business data

---

## 5. What to remove or replace

### Remove / replace Twilio-specific code
- services/twilio_security.py
- Twilio signature validation
- Twilio-specific reply sending logic
- Twilio-specific media handling assumptions

### Replace old webhook model
The current webhook flow is built around Twilio payloads. It should be changed to support:
- WhatsApp Business Platform webhook events
- incoming messages
- media attachments
- status callbacks

### Replace Twilio env settings
Remove or rename these:
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_WHATSAPP_NUMBER
- TWILIO_VALIDATE_SIGNATURE

Add business-platform settings such as:
- WHATSAPP_API_TOKEN
- WHATSAPP_BUSINESS_ACCOUNT_ID
- WHATSAPP_PHONE_NUMBER_ID
- WHATSAPP_WEBHOOK_VERIFY_TOKEN
- WHATSAPP_WEBHOOK_URL

### Remove single-flow assumptions
The current system is designed around one message flow. It should be updated to support:
- vendor identification
- per-vendor state
- per-vendor business context
- separate inventory/ledger/report data for each vendor

---

## 6. New architecture

### A. WhatsApp channel layer
This layer will:
- receive incoming messages from the WhatsApp Business Platform
- receive media audio files
- pass them to the backend for processing
- send text replies back to the vendor

### B. Vendor identity layer
This layer will:
- detect the sender phone number
- map it to a vendor profile
- load the correct business context for that vendor

### C. Conversation layer
This layer will:
- track pending questions
- manage multi-turn conversations
- decide intent routing

### D. Business action layer
This layer will:
- answer inventory requests
- record sales and expenses
- update stock
- generate reports
- handle onboarding and vendor follow-up queries

### E. Data layer
Use tables such as:
- vendors
- vendor_sessions
- messages
- inventory
- ledger
- onboarding_requests

---

## 7. Core workflow

### For a vendor voice message
1. Vendor sends a voice message to the business number
2. WhatsApp Business Platform forwards it to the webhook
3. Backend receives the message and sender number
4. Backend identifies the vendor from the phone number
5. Backend downloads the audio
6. Backend transcribes the audio to text
7. Backend extracts the business intent
8. Backend loads the vendor’s business context
9. Backend performs the required business action
10. Backend sends a text reply to the vendor

---

## 8. Data model changes needed

### Vendor table
Each vendor should have:
- id
- phone_number
- business_name
- business_type
- city
- language
- onboarding_status
- created_at

### Vendor session table
Each session should track:
- vendor_id
- conversation_state
- pending_question
- pending_context
- last_message_at

### Inventory table
Inventory should be scoped by vendor:
- vendor_id
- item_name
- daily_stock
- current_stock
- price_per_unit
- stock_date

### Ledger table
Ledger entries should be associated with vendor:
- vendor_id
- phone_number
- amount
- type
- category
- description
- quantity
- audio_url
- created_at

---

## 9. Migration phases

### Phase 1 — Foundation
- create vendor model
- map WhatsApp sender to vendor profile
- add vendor_id to existing business records

### Phase 2 — Messaging platform swap
- replace Twilio webhook handling in main.py
- replace Twilio reply sending in services/voice_ledger.py
- add WhatsApp Business Platform webhook support

### Phase 3 — Multi-vendor routing
- process each incoming message under the correct vendor context
- ensure inventory and ledger are vendor-scoped

### Phase 4 — Business workflows
- onboarding flow for new vendors
- inventory requests
- sales entry workflow
- reports and insights workflow

### Phase 5 — Frontend update
- update the web app to show vendor dashboard and vendor-specific data
- separate business views for each vendor

### Phase 6 — Production hardening
- webhook verification
- retries and error logging
- media handling failures
- status event monitoring

---

## 10. Recommended implementation strategy

### Best path
Keep the current project and refactor it in layers.

Do not rewrite everything at once.

Instead:
1. keep the engine logic
2. replace the transport layer
3. add vendor-aware routing
4. update the frontend later

This reduces risk and keeps the useful business logic intact.

---

## 11. Final conclusion

The correct direction is:
- move from Twilio to WhatsApp Business Platform
- keep the existing business logic
- transform the project into a multi-vendor WhatsApp business automation system
- make the bot work inside one business number while serving many vendors

This is the right architecture for your use case.
