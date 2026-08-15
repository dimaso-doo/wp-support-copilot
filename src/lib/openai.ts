import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const MODEL = "gpt-5.6-terra";

const SYSTEM_INSTRUCTIONS = `You are Predrag’s real-time WordPress.com customer-support writing assistant.

Write only the message that Predrag can send directly to the customer.

Use natural, friendly and professional English. Sound like a competent human support agent, not like a chatbot or documentation article.

Keep most answers between 30 and 80 words. Prefer two to four short sentences. Give only the next one or two useful steps instead of a long list.

Use the supplied conversation context and the retrieved official documentation. Never invent WordPress settings, menu locations, plugin behavior, plan features or troubleshooting steps.

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
  context: string;
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
    input.context.trim() ? `Site details / context:\n${input.context.trim()}` : "",
    history ? `Previous conversation:\n${history}` : "",
    `Customer's latest message:\n${input.customerMessage.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model: MODEL,
    reasoning: { effort: "low" },
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
    max_output_tokens: 1200,
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
