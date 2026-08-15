"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Source = {
  title: string;
  url: string;
};

type ConversationTurn = {
  customer: string;
  reply: string;
};

type SavedConversation = {
  customerMessage: string;
  reply: string;
  sources: Source[];
  history: ConversationTurn[];
};

const STORAGE_KEY = "wp-support-copilot:conversation:v1";
const EMPTY_CONVERSATION: SavedConversation = {
  customerMessage: "",
  reply: "",
  sources: [],
  history: [],
};

function safeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("title" in item) ||
      !("url" in item) ||
      typeof item.title !== "string" ||
      typeof item.url !== "string"
    ) {
      return [];
    }
    try {
      const url = new URL(item.url);
      const official =
        url.protocol === "https:" &&
        (url.hostname === "wordpress.com" ||
          url.hostname.endsWith(".wordpress.com") ||
          url.hostname === "woocommerce.com" ||
          url.hostname.endsWith(".woocommerce.com"));
      return official ? [{ title: item.title, url: url.toString() }] : [];
    } catch {
      return [];
    }
  });
}

function safeHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is ConversationTurn =>
        typeof item === "object" &&
        item !== null &&
        "customer" in item &&
        "reply" in item &&
        typeof item.customer === "string" &&
        typeof item.reply === "string",
    )
    .slice(-12);
}

export function SupportCopilot() {
  const router = useRouter();
  const [conversation, setConversation] = useState(EMPTY_CONVERSATION);
  const [hydrated, setHydrated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<SavedConversation>;
          setConversation({
            customerMessage:
              typeof parsed.customerMessage === "string"
                ? parsed.customerMessage
                : "",
            reply: typeof parsed.reply === "string" ? parsed.reply : "",
            sources: safeSources(parsed.sources),
            history: safeHistory(parsed.history),
          });
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
    }
  }, [conversation, hydrated]);

  const turnCount = conversation.history.length;
  const turnLabel =
    turnCount === 0
      ? "New conversation"
      : `${turnCount} saved ${turnCount === 1 ? "exchange" : "exchanges"}`;

  async function generateReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = conversation.customerMessage.trim();
    if (!message || isGenerating) return;

    setError("");
    setCopyState("idle");
    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerMessage: message,
          history: conversation.history,
        }),
      });

      const data = (await response.json()) as {
        reply?: string;
        sources?: Source[];
        error?: string;
      };

      if (!response.ok || !data.reply) {
        throw new Error(data.error || "The reply could not be generated.");
      }

      setConversation((current) => ({
        ...current,
        customerMessage: "",
        reply: data.reply ?? "",
        sources: data.sources ?? [],
        history: [
          ...current.history,
          { customer: message, reply: data.reply ?? "" },
        ].slice(-12),
      }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The reply could not be generated.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyReply() {
    if (!conversation.reply) return;
    try {
      await navigator.clipboard.writeText(conversation.reply);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  }

  function clearConversation() {
    if (
      conversation.history.length > 0 &&
      !window.confirm("Clear this saved conversation?")
    ) {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    setConversation(EMPTY_CONVERSATION);
    setError("");
    setCopyState("idle");
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="WP Support Copilot home">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>WP Support Copilot</strong>
            <small>Private writing assistant</small>
          </span>
        </Link>
        <div className="topbar-actions">
          <span className="saved-state">
            <i aria-hidden="true" /> {turnLabel}
          </span>
          <button className="text-button" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <section className="workspace" aria-labelledby="page-title">
        <div className="intro-block">
          <p className="eyebrow">Customer-ready replies</p>
          <h1 id="page-title">A clear next step, in your voice.</h1>
          <p>
            Paste the latest message. Copilot checks official documentation and
            drafts one concise reply for you to review and copy.
          </p>
        </div>

        <form className="copilot-grid" onSubmit={generateReply}>
          <section className="input-panel card" aria-label="Conversation input">
            <div className="field-heading">
              <label htmlFor="customer-message">Customer message</label>
              <span>Required</span>
            </div>
            <textarea
              id="customer-message"
              className="message-area"
              value={conversation.customerMessage}
              onChange={(event) =>
                setConversation((current) => ({
                  ...current,
                  customerMessage: event.target.value.slice(0, 8000),
                }))
              }
              placeholder="Paste the customer’s latest message here…"
              maxLength={8000}
              required
              autoFocus
            />

            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}

            <div className="input-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={!conversation.customerMessage.trim() || isGenerating}
              >
                {isGenerating ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Drafting…
                  </>
                ) : (
                  "Generate reply"
                )}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={clearConversation}
              >
                Clear conversation
              </button>
            </div>
          </section>

          <section className="output-panel card" aria-label="Generated response">
            <div className="output-heading">
              <div>
                <p className="eyebrow">Ready to send</p>
                <h2>Generated response</h2>
              </div>
              {conversation.reply ? <span className="review-pill">Review</span> : null}
            </div>

            <div
              className={`reply-box ${conversation.reply ? "has-reply" : ""}`}
              aria-live="polite"
              aria-busy={isGenerating}
              role="region"
              aria-label="Generated reply"
            >
              {isGenerating ? (
                <div className="reply-loading" aria-label="Generating reply">
                  <span />
                  <span />
                  <span />
                </div>
              ) : conversation.reply ? (
                <p>{conversation.reply}</p>
              ) : (
                <div className="empty-reply">
                  <span aria-hidden="true">✦</span>
                  <p>Your customer-ready reply will appear here.</p>
                  <small>Nothing is sent automatically.</small>
                </div>
              )}
            </div>

            <button
              className="copy-button"
              type="button"
              onClick={copyReply}
              disabled={!conversation.reply || isGenerating}
            >
              <span aria-hidden="true">{copyState === "copied" ? "✓" : "⧉"}</span>
              {copyState === "copied"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy reply"}
            </button>

            <details className="sources">
              <summary>
                Sources used
                <span>{conversation.sources.length}</span>
              </summary>
              <div className="source-list">
                {conversation.sources.length ? (
                  conversation.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>{source.title}</span>
                      <small>{new URL(source.url).hostname}</small>
                    </a>
                  ))
                ) : (
                  <p>Official documentation sources will appear after generation.</p>
                )}
              </div>
            </details>
          </section>
        </form>

        <footer className="app-footer">
          <span>
            <i aria-hidden="true" /> Private session
          </span>
          <p>Replies are always copied and sent manually by you.</p>
        </footer>
      </section>
    </main>
  );
}
