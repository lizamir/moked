/**
 * Sending messages through the WhatsApp Business Cloud API (Meta).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */
import type { Outgoing } from "../sessions.ts";

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
}

export type Fetch = typeof fetch;

/** The request body for one outgoing message. Approval questions become two reply buttons. */
export function toWhatsAppMessage(to: string, message: Outgoing): Record<string, unknown> {
  if (message.kind === "approval") {
    return {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: message.text.slice(0, 1024) },
        action: {
          buttons: [
            { type: "reply", reply: { id: "approve_yes", title: "כן, לאשר" } },
            { type: "reply", reply: { id: "approve_no", title: "לא" } },
          ],
        },
      },
    };
  }
  return { messaging_product: "whatsapp", to, type: "text", text: { body: message.text.slice(0, 4096) } };
}

export function whatsAppSender(config: WhatsAppConfig, fetchImpl: Fetch = fetch) {
  return async (to: string, message: Outgoing): Promise<void> => {
    const response = await fetchImpl(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(toWhatsAppMessage(to, message)),
    });
    if (!response.ok) throw new Error(`WhatsApp send failed: ${response.status} ${await response.text()}`);
  };
}
