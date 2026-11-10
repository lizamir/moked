import path from "node:path";
import { createRetriever, loadKnowledgeBase, type KnowledgeBase } from "../rag/kb.ts";
import type { Retriever } from "../rag/retriever.ts";
import { AppointmentBook } from "../services/appointments.ts";
import { loadProfile, RUNTIME_DIR, systemClock, type BusinessProfile, type Clock } from "../services/business.ts";
import { FileOutbox, type Mailer } from "../services/outbox.ts";
import { RequestLog } from "../services/request-log.ts";
import { calendarTools } from "./calendar.ts";
import { emailTools } from "./email.ts";
import { knowledgeTools } from "./knowledge.ts";
import { logTools } from "./log.ts";
import type { AgentTool } from "./types.ts";

export interface Services {
  profile: BusinessProfile;
  clock: Clock;
  kb: KnowledgeBase;
  retriever: Retriever;
  book: AppointmentBook;
  mailer: Mailer;
  log: RequestLog;
}

/** Wire the real services together. `runtimeDir` is where bookings, mail and the log are written. */
export async function createServices({ runtimeDir = RUNTIME_DIR, clock }: { runtimeDir?: string; clock?: Clock } = {}): Promise<Services> {
  const profile = await loadProfile();
  const now = clock ?? systemClock(profile.timezone);
  const kb = await loadKnowledgeBase();
  return {
    profile,
    clock: now,
    kb,
    retriever: createRetriever(kb),
    book: new AppointmentBook(profile, path.join(runtimeDir, "appointments.json"), now),
    mailer: new FileOutbox(path.join(runtimeDir, "outbox"), profile.email),
    log: new RequestLog(path.join(runtimeDir, "requests.csv"), now),
  };
}

/** Every tool the agent has, in one list. Web search is not here: it runs on Anthropic's servers (see agent/conversation.ts). */
export function createTools(s: Services): AgentTool[] {
  return [...knowledgeTools(s.kb, s.retriever, s.profile.name), ...calendarTools(s.book, s.profile), ...emailTools(s.mailer, s.book, s.profile, s.clock), ...logTools(s.log)];
}
