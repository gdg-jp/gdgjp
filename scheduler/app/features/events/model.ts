export type Event = {
  id: string;
  title: string;
  description: string | null;
  slotMinutes: number;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
