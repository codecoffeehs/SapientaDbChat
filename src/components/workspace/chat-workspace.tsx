import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BotAvatar } from "bot-avatars";
import { ThinkingOrb } from "thinking-orbs";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp02Icon,
  ArrowDown02Icon,
  Copy01Icon,
  CheckmarkCircle02Icon,
  ArrowReloadHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorMessage } from "@/lib/queries";
import type { Workspace } from "@/lib/workspaces";

interface Answer {
  id?: string;
  kind: "answer" | "clarify" | "query" | "lookup";
  message: string;
  query: string | null;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  sources: { schema: string; name: string }[];
  limit?: number;
  notice?: string;
}
interface ChatState {
  conversationId: string | null;
  conversations: { id: string; title: string }[];
  runId: string;
  ready: number;
  turns: { question: string; answer: Answer }[];
}
const phases = {
  searching: {
    label: "Finding the right context",
    detail: "Looking through your table meanings and relationships.",
    orb: "searching",
  },
  planning: {
    label: "Working through your question",
    detail: "Preparing an answer from the relevant context.",
    orb: "solving",
  },
  querying: {
    label: "Reading your data",
    detail: "Running the validated, read-only query.",
    orb: "connecting",
  },
  composing: {
    label: "Putting your answer together",
    detail: "Turning the results into a clear explanation.",
    orb: "composing",
  },
} as const;
type Phase = keyof typeof phases;

function ChatSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      className="mx-auto w-full max-w-3xl space-y-10 px-5 py-12"
    >
      <div className="ml-auto h-16 w-2/3 rounded-3xl bg-muted motion-safe:animate-pulse" />
      <div className="flex gap-4">
        <div className="size-10 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" />
        <div className="flex-1 space-y-3 pt-2">
          {["w-1/4", "w-full", "w-11/12", "w-3/4"].map((width, i) => (
            <div
              key={i}
              className={`h-3 rounded bg-muted motion-safe:animate-pulse ${width}`}
            />
          ))}
        </div>
      </div>
      <span className="sr-only">Opening your conversation…</span>
    </div>
  );
}

function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Answer copied" : "Copy answer"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        <HugeiconsIcon
          icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
          size={15}
        />
      </Button>
      {error && (
        <span role="status" className="text-xs">
          Select the answer to copy it.
        </span>
      )}
    </div>
  );
}

export function ChatWorkspace({ workspace }: { workspace: Workspace }) {
  return <WorkspaceConversations key={workspace.id} workspace={workspace} />;
}

function WorkspaceConversations({ workspace }: { workspace: Workspace }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState("");
  const [creating, setCreating] = useState(false);
  const activeRequest = useRef<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("searching");
  const [away, setAway] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const queryClient = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const key = ["database-chat", workspace.id, conversationId];
  const { data, isPending, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () =>
      invoke<ChatState>("get_chat_state", { workspaceId: workspace.id, conversationId }),
    staleTime: 0,
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const ask = useMutation({
    mutationFn: async (question: string) => {
      const requestId = crypto.randomUUID();
      activeRequest.current = requestId;
      // Listen before invoking so fast stage transitions are not missed.
      const unlisten = await getCurrentWebviewWindow().listen<{
        workspaceId: string;
        requestId: string;
        stage: string;
      }>("chat-progress", ({ payload }) => {
        if (
          payload.requestId === requestId &&
          payload.workspaceId === workspace.id &&
          Object.prototype.hasOwnProperty.call(phases, payload.stage)
        )
          setPhase(payload.stage as Phase);
      });
      try {
        const activeConversation = data?.conversationId ?? await invoke<string>("create_conversation", { workspaceId: workspace.id });
        queryClient.setQueryData<ChatState>(key, (previous) => previous ? { ...previous, conversationId: activeConversation } : previous);
        return await invoke<Answer>("ask_database", {
          workspaceId: workspace.id,
          question,
          conversationId: activeConversation,
          requestId,
        });
      } finally {
        unlisten();
        activeRequest.current = null;
        setStopping(false);
      }
    },
    onMutate: () => {
      setDraft("");
      setPhase("searching");
      follow.current = true;
      setAway(false);
    },
    onSuccess: (answer, question) => {
      queryClient.setQueryData<ChatState>(key, (previous) =>
        previous
          ? {
            ...previous,
            turns:
              answer.id &&
                previous.turns.some((turn) => turn.answer.id === answer.id)
                ? previous.turns
                : [...previous.turns, { question, answer }],
          }
          : previous,
      );
      void queryClient.invalidateQueries({ queryKey: key });
      input.current?.focus();
    },
    onError: (_error, question) => {
      setDraft((current) => current || question);
      input.current?.focus();
    },
  });
  const busy = ask.isPending;
  const scrollToLatest = () => {
    const element = scroller.current;
    if (element)
      element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
    follow.current = true;
    setAway(false);
  };
  useEffect(() => {
    if (follow.current) scrollToLatest();
  }, [data?.turns.length, busy, ask.isError]);
  useEffect(() => {
    const textarea = input.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  }, [draft]);
  const send = () => {
    if (draft.trim() && !busy && data && !error) ask.mutate(draft.trim());
  };
  const choose = (text: string) => {
    setDraft(text);
    input.current?.focus();
  };
  const currentPhase = phases[phase];

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-5 py-2">
        <select aria-label="Conversation" className="min-w-0 flex-1 rounded-lg border bg-background p-2 text-sm" disabled={ask.isPending || creating} value={data?.conversationId ?? ""} onChange={(event) => { setConversationId(event.target.value); setDraft(""); ask.reset(); follow.current = true; }}>
          {!data?.conversations.length && <option value="">New conversation</option>}
          {data?.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
        </select>
        <Button variant="outline" disabled={ask.isPending || creating} onClick={async () => {
          setCreating(true); setConversationError("");
          try { const id = await invoke<string>("create_conversation", { workspaceId: workspace.id }); setConversationId(id); setDraft(""); ask.reset(); follow.current = true; }
          catch (error) { setConversationError(String(error)); }
          finally { setCreating(false); }
        }}>{creating ? "Creating…" : "New conversation"}</Button>
      </div>
      {conversationError && <p role="alert" className="px-5 py-2 text-sm text-destructive">{conversationError}</p>}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3 sm:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{workspace.name}</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Conversation
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/workspaces/$workspaceId/map"
            params={{ workspaceId: workspace.id }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Database map
          </Link>
          <Link
            to="/workspaces/$workspaceId/ingestion"
            params={{ workspaceId: workspace.id }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Ingestion results
          </Link>
        </div>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            120;
          setAway(!follow.current);
        }}
      >
        {isPending ? (
          <ChatSkeleton />
        ) : error ? (
          <div
            role="alert"
            className="mx-auto my-10 max-w-xl rounded-2xl border p-6"
          >
            <h2 className="font-medium">Couldn’t open this conversation</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage(error, "Please try again.")}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => void refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 sm:px-6">
            {!data?.turns.length && !busy && !ask.isError && (
              <div className="flex min-h-[35vh] flex-col items-center justify-center py-8 text-center">
                <h2 className="mt-5 text-3xl font-medium tracking-tight">
                  What would you like to explore?
                </h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  Ask a question about your data. We’ll find the context and
                  help you make sense of it.
                </p>
                {/* <div className="mt-7 grid w-full max-w-lg gap-2 sm:grid-cols-2">
                  {[
                    {
                      label: "Explore my database",
                      prompt: "What information is available in this database?",
                    },
                    {
                      label: "Understand relationships",
                      prompt: "How are my tables related?",
                    },
                  ].map(({ label, prompt }) => (
                    <button
                      key={label}
                      onClick={() => choose(prompt)}
                      className="rounded-xl border px-4 py-3 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {label}
                      <span
                        aria-hidden="true"
                        className="float-right text-muted-foreground"
                      >
                        ↗
                      </span>
                    </button>
                  ))}
                </div> */}
              </div>
            )}
            <div className="space-y-10">
              {data?.turns.map((turn, index) => (
                <article
                  key={turn.answer.id ?? index}
                  className="space-y-6"
                  aria-label={`Exchange ${index + 1}`}
                >
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-3xl rounded-tr-lg bg-muted px-5 py-3.5 text-sm leading-7 whitespace-pre-wrap break-words">
                      <span className="sr-only">You: </span>
                      {turn.question}
                    </div>
                  </div>
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="shrink-0 pt-0.5">
                      <BotAvatar
                        type="clover"
                        state="default"
                        size={36}
                        paused={
                          reducedMotion ||
                          busy ||
                          index !== (data?.turns.length ?? 0) - 1
                        }
                        aria-label="Sapienta"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 text-xs font-medium">
                        Sapienta
                        {turn.answer.kind === "clarify" && (
                          <span className="ml-2 font-normal text-muted-foreground">
                            · A quick question
                          </span>
                        )}
                      </p>
                      <div className="text-sm leading-7 whitespace-pre-wrap break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
                          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
                          h1: ({ children }) => <h3 className="my-3 text-lg font-semibold">{children}</h3>,
                          h2: ({ children }) => <h3 className="my-3 font-semibold">{children}</h3>,
                          h3: ({ children }) => <h4 className="my-2 font-semibold">{children}</h4>,
                          a: ({ children }) => <span className="underline">{children}</span>,
                          img: () => null,
                          table: ({ children }) => <div className="overflow-x-auto"><table className="my-3 w-full text-left text-sm">{children}</table></div>,
                          th: ({ children }) => <th className="border-b p-2 font-medium">{children}</th>,
                          td: ({ children }) => <td className="border-b p-2">{children}</td>,
                        }}>{turn.answer.message}</ReactMarkdown>
                      </div>
                      {turn.answer.query && (
                        <>
                          {turn.answer.limit === turn.answer.rows.length && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Showing up to {turn.answer.limit} results. Narrow
                              your question to see a smaller set.
                            </p>
                          )}
                          {turn.answer.notice && (
                            <p
                              role="status"
                              className="mt-3 text-xs text-muted-foreground"
                            >
                              {turn.answer.notice}
                            </p>
                          )}
                        </>
                      )}
                      <div className="mt-3 flex items-start gap-3 text-muted-foreground">
                        <CopyAnswer text=<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
                          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
                          h1: ({ children }) => <h3 className="my-3 text-lg font-semibold">{children}</h3>,
                          h2: ({ children }) => <h3 className="my-3 font-semibold">{children}</h3>,
                          h3: ({ children }) => <h4 className="my-2 font-semibold">{children}</h4>,
                          a: ({ children }) => <span className="underline">{children}</span>,
                          img: () => null,
                          table: ({ children }) => <div className="overflow-x-auto"><table className="my-3 w-full text-left text-sm">{children}</table></div>,
                          th: ({ children }) => <th className="border-b p-2 font-medium">{children}</th>,
                          td: ({ children }) => <td className="border-b p-2">{children}</td>,
                        }}>{turn.answer.message}</ReactMarkdown> />
                        <details className="min-w-0 flex-1 pt-1.5 text-xs">
                          <summary className="w-fit cursor-pointer hover:text-foreground">
                            Sources{turn.answer.query ? " & query" : ""}
                          </summary>
                          <div className="mt-3 rounded-xl bg-muted/40 p-4">
                            <ul className="space-y-1">
                              {turn.answer.sources.map((source) => (
                                <li key={`${source.schema}.${source.name}`}>
                                  {source.schema ? `${source.schema}.` : ""}
                                  {source.name}
                                </li>
                              ))}
                            </ul>
                            {turn.answer.query && (
                              <pre className="mt-3 overflow-x-auto border-t pt-3 text-[11px] leading-5 whitespace-pre-wrap break-words">
                                {turn.answer.query}
                              </pre>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {(busy || ask.isError) && (
              <div className="mt-10 space-y-6">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl rounded-tr-lg bg-muted px-5 py-3.5 text-sm leading-7 whitespace-pre-wrap break-words">
                    <span className="sr-only">You: </span>
                    {ask.variables}
                  </div>
                </div>
                <div className="flex items-start gap-3 sm:gap-4">
                  <BotAvatar
                    type="clover"
                    state={busy ? "working" : "default"}
                    size={36}
                    paused={reducedMotion}
                    aria-label="Sapienta"
                  />
                  <div className="min-w-0 flex-1">
                    {busy ? (
                      <div role="status" aria-live="polite">
                        <p className="text-xs font-medium">Sapienta</p>
                        <div className="mt-2 flex items-center gap-3">
                          <ThinkingOrb
                            state={currentPhase.orb}
                            size={64}
                            paused={reducedMotion}
                            aria-hidden="true"
                          />
                          <div>
                            <p className="text-sm font-medium">
                              {currentPhase.label}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {currentPhase.detail}
                            </p>
                          </div>
                        </div>
                        <div aria-hidden="true" className="mt-4 space-y-2.5">
                          <div className="h-2 w-4/5 rounded-full bg-muted motion-safe:animate-pulse" />
                          <div className="h-2 w-3/5 rounded-full bg-muted motion-safe:animate-pulse" />
                        </div>
                      </div>
                    ) : (
                      <div
                        role="alert"
                        className="rounded-xl border border-destructive/20 bg-destructive/5 p-4"
                      >
                        <p className="text-sm font-medium">
                          We couldn’t finish that answer
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {errorMessage(ask.error, "Please try again.")}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 gap-2"
                          onClick={() => {
                            if (ask.variables) ask.mutate(ask.variables);
                          }}
                        >
                          <HugeiconsIcon
                            icon={ArrowReloadHorizontalIcon}
                            size={14}
                          />
                          Try again
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="relative shrink-0 bg-background px-4 pt-3 pb-4 sm:px-6">
        {away && (
          <Button
            size="icon-sm"
            variant="outline"
            className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-sm"
            aria-label="Jump to latest message"
            onClick={scrollToLatest}
          >
            <HugeiconsIcon icon={ArrowDown02Icon} size={16} />
          </Button>
        )}
        <div className="mx-auto max-w-3xl">
          <form
            className="rounded-3xl border bg-muted/20 p-3 shadow-[0_4px_24px_-16px_var(--ring)] transition-shadow focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/10"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label htmlFor="database-question" className="sr-only">
              Message Sapienta
            </label>
            <textarea
              ref={input}
              id="database-question"
              className="block min-h-12 max-h-45 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
              placeholder={
                busy
                  ? "Write your next question…"
                  : "Ask anything about your data…"
              }
              value={draft}
              maxLength={4000}
              rows={1}
              disabled={isPending || !!error}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-3 pl-2">
              <span className="truncate text-[11px] text-muted-foreground">
                {workspace.databaseName}
                <span className="mx-2 text-border">·</span>Read-only
              </span>
              <Button
                type={busy ? "button" : "submit"}
                onClick={busy ? async () => {
                  if (!activeRequest.current) return;
                  setStopping(true);
                  try { await invoke("cancel_chat", { requestId: activeRequest.current }); }
                  catch (error) { setConversationError(String(error)); setStopping(false); }
                } : undefined}
                size="icon"
                className="size-9 rounded-full"
                disabled={busy ? stopping : !draft.trim() || isPending || !!error}
                aria-label={busy ? "Stop response" : "Send message"}
              >
                {busy ? <span className="size-3 rounded-sm bg-current" /> : <HugeiconsIcon icon={ArrowUp02Icon} size={19} />}
              </Button>
            </div>
          </form>
          <p className="mt-2.5 text-center text-[10px] leading-4 text-muted-foreground">
            AI can make mistakes. Relevant schema and a small result sample are
            sent to your AI provider.
          </p>
        </div>
      </footer>
    </div>
  );
}
