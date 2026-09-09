import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@/components/common/Toast";
import { ResearchDocumentsTab } from "@/components/research/ResearchDocumentsTab";
import { WatchlistPage } from "@/pages/WatchlistPage";
import { useConversations } from "@/hooks/useConversations";
import { useChatRunController } from "@/hooks/useChatRunController";

function ChatFixture() {
  const history = useConversations();
  const chat = useChatRunController({ chatHistory: history, language: "en", productAnalyticsEnabled: false, onSendStart() {} });
  return <section>
    <p data-testid="chat-ready">{history.isLoading ? "Loading" : "Ready"}</p>
    <input aria-label="Prompt" value={chat.prompt} onChange={(event) => chat.setPrompt(event.target.value)} />
    <button onClick={() => void chat.handleSend()} disabled={chat.activeIsSending}>Send</button>
    <button onClick={() => void chat.handleStopStreaming()}>Stop</button>
    <div data-testid="chat-messages">{history.activeConversation?.messages.map((message) => <p key={message.id} data-pending={String(Boolean(message.pending))}>{message.role}: {message.content}</p>)}</div>
  </section>;
}

function Fixture() {
  const [page, setPage] = useState("watchlist");
  const [symbol, setSymbol] = useState("AAPL.US");
  useEffect(() => {
    const state = window as unknown as { strictMounts?: number };
    state.strictMounts = (state.strictMounts ?? 0) + 1;
  }, []);
  return <>
    <nav>{["watchlist", "documents", "chat"].map((name) => <button key={name} onClick={() => setPage(name)}>{name}</button>)}</nav>
    {page === "watchlist" ? <WatchlistPage language="en" onOpenFinancials={() => {}} /> : null}
    {page === "documents" ? <><button onClick={() => setSymbol("MSFT.US")}>Switch company</button><p data-testid="symbol">{symbol}</p><ResearchDocumentsTab key={symbol} language="en" symbol={symbol} onChanged={async () => {}} /></> : null}
    {page === "chat" ? <ChatFixture /> : null}
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ToastProvider><Fixture /></ToastProvider></StrictMode>);
