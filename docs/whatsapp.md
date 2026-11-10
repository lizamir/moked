# Connecting the agent to WhatsApp

The code is ready (`src/interfaces/whatsapp/`) and covered by tests against fake Meta requests. It has not been connected to a real WhatsApp number yet. These are the steps, in order. Steps 1 to 3 need your own Meta account and cannot be done from code.

## What you need

- A Meta (Facebook) account and a Meta developer account: <https://developers.facebook.com>
- A phone number for the business that is **not** already used in the regular WhatsApp app. Meta also gives a free test number for development.
- A server with a public HTTPS address, because Meta has to reach the webhook. For testing, a tunnel from your computer works (for example Cloudflare Tunnel or ngrok); for real use, a small server (Render, Railway, Fly.io, a VPS).

## Steps

1. **Create an app.** In the Meta developer console: Create App, type "Business", then add the **WhatsApp** product. Meta creates a test business number.
2. **Copy four values into `.env`:**
   - `WHATSAPP_TOKEN`: the access token (the temporary one works for a day; create a permanent System User token for real use)
   - `WHATSAPP_PHONE_NUMBER_ID`: on the WhatsApp > API Setup page
   - `WHATSAPP_APP_SECRET`: App settings > Basic > App secret
   - `WHATSAPP_VERIFY_TOKEN`: any long random string you choose; you will type the same string in step 4
3. **Add your own phone** as a test recipient on the API Setup page (test numbers can only message approved recipients).
4. **Start the webhook and expose it:**
   ```bash
   npm run whatsapp            # listens on port 3200
   ```
   Point your tunnel or server at port 3200. In the console, WhatsApp > Configuration > Webhook: callback URL `https://<your-address>/webhook`, verify token = the value from step 2. Then subscribe to the **messages** field.
5. **Send a WhatsApp message** to the test number from your phone. The agent answers; when it wants to book or send an email, you get two buttons, "כן, לאשר" and "לא".

## How it works

- Meta sends every incoming message to `POST /webhook`, signed with the app secret. The server checks the signature, answers 200 at once, and hands the message to `ChatSessions` (`src/interfaces/sessions.ts`), the same layer the browser chat uses.
- Each phone number gets its own conversation. When the agent needs approval, the session sends the buttons and keeps the agent paused until that number replies.
- Replies go out through the Cloud API (`src/interfaces/whatsapp/client.ts`).

## Before real customers

- Conversations live in memory: a restart forgets them. Store sessions in a database for production.
- Bookings, emails and the request log are still local files. Connect a real calendar and mailer first (the `Mailer` interface and `AppointmentBook` are the places to do it).
- WhatsApp only lets a business send free-form messages within 24 hours of the customer's last message. Reminders after that need pre-approved message templates.
- Meta requires business verification before the number can talk to the public.
