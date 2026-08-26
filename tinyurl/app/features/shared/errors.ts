export type FeatureFailure = {
  ok: false;
  code: "invalid_input" | "forbidden" | "not_found" | "conflict";
  error: string;
};

export function featureFailure(code: FeatureFailure["code"], error: string): FeatureFailure {
  return { ok: false, code, error };
}
