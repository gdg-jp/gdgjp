export type Participant = {
  id: number;
  eventId: string;
  userId: string | null;
  displayName: string;
  editTokenHash: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type Availability = { participantId: number; slotId: number };
