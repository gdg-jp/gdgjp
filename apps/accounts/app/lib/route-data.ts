import type { useLoaderData } from "react-router";

export type RouteData<T> = ReturnType<typeof useLoaderData<T>>;
