import type { Approver, Step, Turn } from "../agent/conversation.ts";

/** What the agent sends back to a person: an answer, a question that needs yes or no, or a short status. */
export type Outgoing =
  | { kind: "text"; text: string; steps: Step[] }
  | { kind: "approval"; text: string }
  | { kind: "status"; text: string };

export type Send = (userId: string, message: Outgoing) => Promise<void>;
/** Starts one person's conversation. The approver it receives is wired to that person's next reply. */
export type StartConversation = (approve: Approver) => Promise<{ send(text: string): Promise<Turn> }>;

const YES = new Set(["כן", "כ", "בטח", "מאשר", "מאשרת", "אשר", "yes", "y", "ok", "👍", "approve_yes"]);
const NO = new Set(["לא", "ל", "בטל", "no", "n", "approve_no"]);

/** "כן!" -> true, "לא תודה" -> false, anything else -> null (ask again rather than guess). */
export function parseApproval(text: string): boolean | null {
  const word = text.trim().toLowerCase().replace(/[.!?,]+$/u, "").split(/\s+/u)[0] ?? "";
  if (YES.has(word)) return true;
  if (NO.has(word)) return false;
  return null;
}

interface Session {
  conversation: ReturnType<StartConversation>;
  busy: boolean;
  /** Set while the agent is waiting for this person to approve an action. */
  pendingApproval?: (approved: boolean) => void;
}

/**
 * Many people, each with their own conversation, over a channel where
 * messages arrive one at a time (a web chat, WhatsApp).
 *
 * In the terminal the approval question can block and wait for typing. Here
 * the "yes" arrives later, as a new message, so the session keeps the agent
 * paused on a promise and resolves it when that message comes in.
 */
export class ChatSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly start: StartConversation,
    private readonly send: Send,
  ) {}

  /**
   * Handle one incoming message. Resolves when this message is fully handled,
   * which for a request that needs approval is only after the person answers.
   * Channel handlers therefore must not await it before acknowledging.
   */
  async receive(userId: string, text: string): Promise<void> {
    const session = this.session(userId);

    if (session.pendingApproval) {
      const approved = parseApproval(text);
      if (approved === null) return this.send(userId, { kind: "approval", text: 'רק כדי לוודא: לאשר? אפשר לענות "כן" או "לא".' });
      const resolve = session.pendingApproval;
      session.pendingApproval = undefined;
      resolve(approved);
      return;
    }

    if (session.busy) return this.send(userId, { kind: "status", text: "רגע, אני עוד מטפל בהודעה הקודמת." });

    session.busy = true;
    try {
      const turn = await (await session.conversation).send(text);
      await this.send(userId, { kind: "text", text: turn.answer, steps: turn.steps });
    } catch (error) {
      console.error(`[${userId}]`, error);
      await this.send(userId, { kind: "status", text: "משהו השתבש אצלי. אפשר לנסות שוב בעוד רגע." });
    } finally {
      session.busy = false;
    }
  }

  private session(userId: string): Session {
    let session = this.sessions.get(userId);
    if (!session) {
      const created: Session = { busy: false, conversation: undefined! };
      created.conversation = this.start(async ({ summary }) => {
        // Start waiting before asking: a fast reply must find the question already open.
        const answer = new Promise<boolean>((resolve) => (created.pendingApproval = resolve));
        await this.send(userId, { kind: "approval", text: `לפני שאני ממשיך, צריך את האישור שלך:\n${summary}\nלאשר?` });
        return answer;
      });
      this.sessions.set(userId, (session = created));
    }
    return session;
  }
}
