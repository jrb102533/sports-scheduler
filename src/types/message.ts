export interface TeamMessage {
  id: string;
  teamId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export interface DmThread {
  id: string;
  /** Both participant UIDs */
  participants: [string, string];
  /** Map of uid → display name */
  participantNames: Record<string, string>;
  lastMessage: string;
  lastMessageAt: string;
  updatedAt: string;
}

export interface DmMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}
