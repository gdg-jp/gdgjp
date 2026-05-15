import { createContext, useContext } from "react";
import type { FirebaseConfig } from "./firebase-messaging.client";

export const FirebaseConfigContext = createContext<FirebaseConfig | null>(null);

export function useFirebaseConfig(): FirebaseConfig | null {
  return useContext(FirebaseConfigContext);
}
