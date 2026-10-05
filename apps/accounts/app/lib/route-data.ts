import type { useLoaderData } from "react-router";

/** The public router hook defines the serialized data delivered to route-owned pages. */
export type RouteData<T> = ReturnType<typeof useLoaderData<T>>;
