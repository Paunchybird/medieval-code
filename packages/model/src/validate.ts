import type { TownModel } from "./schema.js";

export function validateTownModel(data: unknown): data is TownModel {
  if (!data || typeof data !== "object") return false;
  const m = data as TownModel;
  return (
    !!m.meta &&
    typeof m.meta.root === "string" &&
    Array.isArray(m.districts) &&
    Array.isArray(m.edges) &&
    Array.isArray(m.roads) &&
    !!m.bounds
  );
}
