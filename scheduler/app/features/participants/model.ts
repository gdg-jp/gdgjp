export type Participant = {
  id: number;
  eventId: string;
  userId: string | null;
  displayName: string;
  editTokenHash: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Availability = { participantId: number; slotId: number };
