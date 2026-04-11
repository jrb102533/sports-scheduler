import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { TeamMessage, DmMessage } from '@/types';

type AnyMessage = TeamMessage | DmMessage;

interface ThreadViewProps {
  messages: AnyMessage[];
  loading: boolean;
  currentUid: string;
  placeholder?: string;
  onSend: (text: string) => Promise<void>;
}

export function ThreadView({ messages, loading, currentUid, placeholder = 'Type a message…', onSend }: ThreadViewProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSendError(null);
    setSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } catch (err) {
      console.error('[ThreadView] send failed:', err);
      setSendError('Failed to send — please try again.');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <p className="text-center text-sm text-gray-400 py-8">Loading…</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">No messages yet. Say hello!</p>
        )}
        {messages.map(msg => {
          const isMine = msg.senderId === currentUid;
          return (
            <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-700">
                {msg.senderName.charAt(0).toUpperCase()}
              </div>
              <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                {!isMine && (
                  <span className="text-[10px] text-gray-500 px-1">{msg.senderName}</span>
                )}
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words ${
                    isMine
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-gray-100 text-gray-900 rounded-tl-sm'
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[10px] text-gray-400 px-1">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="border-t border-gray-100 p-3 bg-white">
        {sendError && (
          <p className="text-xs text-red-600 mb-2">{sendError}</p>
        )}
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={sending}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white disabled:opacity-40 hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            <Send size={15} />
          </button>
        </form>
        <p className="text-[10px] text-gray-400 mt-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
