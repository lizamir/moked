import type { CustomerRequest } from "./request-log.ts";

export interface Ticket {
  /** The ticket number the staff and the customer can refer to, e.g. "PARVA-12". */
  key: string;
  url: string;
}

/** Any system where a staff request becomes a ticket someone owns. Jira today; swap the class for another. */
export interface TicketSystem {
  open(request: CustomerRequest): Promise<Ticket>;
}

export interface JiraConfig {
  /** https://your-site.atlassian.net */
  baseUrl: string;
  /** The account the API token belongs to. Use a dedicated account that can only create issues in one project. */
  email: string;
  apiToken: string;
  projectKey: string;
  issueType?: string;
}

/** Jira Cloud wants rich text as "ADF" JSON, not a plain string. One paragraph per line is enough here. */
const toAdf = (lines: string[]) => ({
  type: "doc",
  version: 1,
  content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
});

/** Opens a Jira issue for each staff request, through Jira Cloud's REST API. */
export class JiraTickets implements TicketSystem {
  private readonly auth: string;

  constructor(
    private readonly config: JiraConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
  }

  async open(request: CustomerRequest): Promise<Ticket> {
    const response = await this.fetchImpl(`${this.config.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: { authorization: this.auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: this.config.projectKey },
          issuetype: { name: this.config.issueType ?? "Task" },
          summary: `${request.topic}: ${request.customerName}`.slice(0, 255),
          description: toAdf([`לקוח/ה: ${request.customerName}`, `דרך ליצירת קשר: ${request.contact}`, request.details, "נפתח אוטומטית על ידי הסוכן, אחרי אישור הלקוח."]),
          labels: ["moked-agent"],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // The status is enough to act on, and unlike the body it can never echo a credential into a log.
    if (!response.ok) throw new Error(`Jira refused the ticket (HTTP ${response.status})`);
    const { key } = (await response.json()) as { key: string };
    return { key, url: `${this.config.baseUrl}/browse/${key}` };
  }
}

const JIRA_VARS = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT_KEY"] as const;

/** Jira is optional: with none of the variables set the agent keeps to the CSV log. A half-filled set is a mistake worth stopping for. */
export function jiraFromEnv(env: NodeJS.ProcessEnv = process.env): JiraTickets | undefined {
  const set = JIRA_VARS.filter((name) => env[name]?.trim());
  if (set.length === 0) return undefined;
  if (set.length < JIRA_VARS.length) throw new Error(`Jira is half configured. Missing: ${JIRA_VARS.filter((name) => !set.includes(name)).join(", ")}`);
  const baseUrl = env.JIRA_BASE_URL!.trim().replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("JIRA_BASE_URL must start with https://");
  return new JiraTickets({ baseUrl, email: env.JIRA_EMAIL!.trim(), apiToken: env.JIRA_API_TOKEN!.trim(), projectKey: env.JIRA_PROJECT_KEY!.trim() });
}
