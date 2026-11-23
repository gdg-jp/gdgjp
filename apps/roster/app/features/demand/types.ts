export type Demand = {
  timeSlotId: string;
  trackId: string;
  roleId: string;
  min: number;
  ideal: number;
  leadMin: number;
  newMax: number;
};

export type DemandValue = Pick<Demand, "min" | "ideal" | "leadMin" | "newMax">;
