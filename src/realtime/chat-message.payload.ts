/** Wire shape client-gateway emits over the `/chat` WebSocket namespace, and
 * the Console's `use-ticket-chat.ts` hook consumes -- mirrors
 * `chat-microservice`'s `ChatMessageResult` (`get_chat_thread`'s NATS
 * response shares this shape). */
export interface ChatMessagePayload {
  id: string;
  senderType: 'agent' | 'requester';
  senderId: string | null;
  body: string;
  lang: string | null;
  status: 'delivered' | 'seen';
  createdAt: string;
}

export interface ChatThreadSyncedPayload {
  ticketId: string;
  messages: ChatMessagePayload[];
}

export interface ChatMessageSeenPayload {
  ticketId: string;
  viewerType: 'agent' | 'requester';
}
