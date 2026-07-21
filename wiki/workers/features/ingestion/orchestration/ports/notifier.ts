export interface IngestionNotifier {
  completed(sessionId: string, userId: string): Promise<void>;
  failed(sessionId: string, userId: string, errorCode: string): Promise<void>;
}
