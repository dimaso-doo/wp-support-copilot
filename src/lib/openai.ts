import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const MODEL = "gpt-5.6-sol";

const SYSTEM_INSTRUCTIONS = `You are Predrag’s real-time WordPress.com customer-support writing assistant.

Write only the message that Predrag can send directly to the customer.

Use natural, friendly and professional English. Sound like a competent human support agent, not like a chatbot or documentation article.

Use a warm, understanding and moderately friendly tone.

When the customer describes a problem, delay, confusion, repeated troubleshooting or disappointment, begin with one short, situation-specific acknowledgment. Show that you understand the practical impact without exaggerating their emotions or making assumptions.

Examples of the desired tone:
- “I can see why that would be confusing, especially after you already updated the domain.”
- “Thanks for checking that — it helps narrow this down.”
- “That’s understandably frustrating when the old version is still appearing.”
- “You’ve already ruled out the most common cause, so let’s check one more thing.”

After acknowledging the situation, move naturally to the next useful step. Use collaborative language such as “let’s check”, “we can narrow this down”, or “the next thing to verify”.

Keep empathy to one brief sentence. If the customer’s message is neutral or purely informational, do not invent frustration or add an unnecessary apology.

Avoid generic or scripted phrases such as “I completely understand your frustration”, “Rest assured”, “We sincerely apologize for the inconvenience”, “No worries”, or “I’d be more than happy to assist you today”.

The reply should feel like it was written by a calm, experienced and approachable support agent who is personally paying attention to the conversation.

Keep most answers between 30 and 80 words. Prefer two to four short sentences. Give only the next one or two useful steps instead of a long list.

Use the previous conversation and the retrieved official documentation. Never invent WordPress settings, menu locations, plugin behavior, plan features or troubleshooting steps.

First understand what the customer has already confirmed. Do not repeat steps they have already tried.

If essential information is missing, ask exactly one focused diagnostic question. Do not guess.

Do not say that something is ‘very simple’, ‘easy’ or ‘obvious’. Do not blame the customer. Avoid unnecessary apologies, excessive enthusiasm and robotic phrases.

Do not include citations, source numbers, internal reasoning, confidence scores, headings such as ‘Suggested reply’, or explanations intended for Predrag. Output only the customer-ready reply.

Use plain text only. Do not use Markdown, bullets, bold markers or other formatting syntax.

Use correct spelling and grammar. Use ‘then’, not ‘than’. Use ‘your’, not ‘you’re’, unless grammatically appropriate.

Never request passwords, API keys, login credentials, payment information or other sensitive information.

Always search the connected official-documentation vector store before answering. Populate the structured sources field only with official documentation that directly supports the reply. If retrieval is insufficient, set confidence to low and make the reply exactly one focused clarifying question rather than speculative instructions. Never place citations in the reply itself.`;

const SupportResponseSchema = z.object({
  reply: z.string().min(1).max(1200),
  sources: z
    .array(
      z.object({
        title: z.string().min(1).max(180),
        url: z.string().min(1).max(500),
      }),
    )
    .max(6),
  confidence: z.enum(["low", "medium", "high"]),
});

export type SupportResponse = z.infer<typeof SupportResponseSchema>;

function officialSource(source: { title: string; url: string }) {
  try {
    const url = new URL(source.url);
    const allowed =
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "wordpress.com" ||
        url.hostname.endsWith(".wordpress.com") ||
        url.hostname === "woocommerce.com" ||
        url.hostname.endsWith(".woocommerce.com"));
    return allowed ? { title: source.title, url: url.toString() } : null;
  } catch {
    return null;
  }
}

export async function draftSupportReply(input: {
  customerMessage: string;
  history: Array<{ customer: string; reply: string }>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!vectorStoreId) throw new Error("OPENAI_VECTOR_STORE_ID is not configured.");

  const history = input.history
    .slice(-12)
    .map(
      (turn, index) =>
        `Exchange ${index + 1}\nCustomer: ${turn.customer}\nPredrag: ${turn.reply}`,
    )
    .join("\n\n");

  const prompt = [
    history ? `Previous conversation:\n${history}` : "",
    `Customer's latest message:\n${input.customerMessage.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model: MODEL,
    reasoning: { effort: "max" },
    instructions: SYSTEM_INSTRUCTIONS,
    input: prompt,
    tools: [
      {
        type: "file_search",
        vector_store_ids: [vectorStoreId],
        max_num_results: 6,
      },
    ],
    include: ["file_search_call.results"],
    text: {
      format: zodTextFormat(SupportResponseSchema, "support_reply"),
      verbosity: "low",
    },
    max_output_tokens: 8000,
    store: false,
  });

  if (!response.output_parsed) {
    throw new Error("The model did not return a usable reply.");
  }

  const sources = response.output_parsed.sources
    .map(officialSource)
    .filter((source): source is { title: string; url: string } => source !== null)
    .filter(
      (source, index, all) =>
        all.findIndex((candidate) => candidate.url === source.url) === index,
    );

  return { ...response.output_parsed, sources } satisfies SupportResponse;
}
