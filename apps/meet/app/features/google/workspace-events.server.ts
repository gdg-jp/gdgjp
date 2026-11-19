import {
  GoogleApiError,
  type GoogleFetch,
  encodeResourcePath,
  googleJsonRequest,
  paginateAll,
} from "~/features/google/client.server";

const WORKSPACE_EVENTS_API_BASE = "https://workspaceevents.googleapis.com/v1";

export type WorkspaceEventSubscription = {
  name: string;
  uid?: string;
  targetResource: string;
  eventTypes: string[];
  notificationEndpoint: {
    pubsubTopic: string;
  };
  payloadOptions?: {
    includeResource?: boolean;
  };
  state?: "ACTIVE" | "SUSPENDED" | "DELETED" | string;
  suspensionReason?: string;
  expireTime?: string;
  createTime?: string;
  updateTime?: string;
};

type WorkspaceEventsOperation<T> = {
  name: string;
  done?: boolean;
  response?: T & { "@type"?: string };
  error?: {
    code?: number;
    status?: string;
    message?: string;
  };
};

export type SubscriptionOperationResult = {
  done: boolean;
  operationName: string;
  subscription: WorkspaceEventSubscription | null;
};

function interpretSubscriptionOperation(
  op: WorkspaceEventsOperation<WorkspaceEventSubscription>,
): SubscriptionOperationResult {
  if (op.error) {
    throw new GoogleApiError({
      httpStatus: op.error.code ?? 500,
      apiStatus: op.error.status,
      apiMessage: op.error.message ?? "Workspace Events オペレーションが失敗しました",
    });
  }
  return {
    done: Boolean(op.done),
    operationName: op.name,
    subscription: op.response ?? null,
  };
}

export async function createSubscription(
  accessToken: string,
  options: {
    targetResource: string;
    eventTypes: string[];
    pubsubTopic: string;
    includeResource?: boolean;
  },
  fetchFn?: GoogleFetch,
): Promise<SubscriptionOperationResult> {
  const op = await googleJsonRequest<WorkspaceEventsOperation<WorkspaceEventSubscription>>({
    accessToken,
    method: "POST",
    url: `${WORKSPACE_EVENTS_API_BASE}/subscriptions`,
    body: {
      targetResource: options.targetResource,
      eventTypes: options.eventTypes,
      notificationEndpoint: {
        pubsubTopic: options.pubsubTopic,
      },
      payloadOptions: {
        includeResource: options.includeResource ?? false,
      },
    },
    fetchFn,
  });
  return interpretSubscriptionOperation(op);
}

export async function getSubscription(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<WorkspaceEventSubscription> {
  return googleJsonRequest<WorkspaceEventSubscription>({
    accessToken,
    method: "GET",
    url: `${WORKSPACE_EVENTS_API_BASE}/${encodeResourcePath(name)}`,
    fetchFn,
  });
}

/**
 * 購読一覧を取得する。Workspace Events API 仕様上 `filter` は必須
 * （例: `event_types:"google.workspace.meet.conference.v2.ended"`）。
 */
export async function listSubscriptions(
  accessToken: string,
  filter: string,
  fetchFn?: GoogleFetch,
): Promise<WorkspaceEventSubscription[]> {
  if (!filter.trim()) {
    throw new Error("listSubscriptions には filter の指定が必須です");
  }
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams({ filter });
      if (pageToken) params.set("pageToken", pageToken);
      return googleJsonRequest<{
        subscriptions?: WorkspaceEventSubscription[];
        nextPageToken?: string;
      }>({
        accessToken,
        method: "GET",
        url: `${WORKSPACE_EVENTS_API_BASE}/subscriptions?${params.toString()}`,
        fetchFn,
      });
    },
    (page) => page.subscriptions,
  );
}

export async function patchSubscriptionTtl(
  accessToken: string,
  name: string,
  ttl = "0s",
  fetchFn?: GoogleFetch,
): Promise<SubscriptionOperationResult> {
  const params = new URLSearchParams({ updateMask: "ttl" });
  const op = await googleJsonRequest<WorkspaceEventsOperation<WorkspaceEventSubscription>>({
    accessToken,
    method: "PATCH",
    url: `${WORKSPACE_EVENTS_API_BASE}/${encodeResourcePath(name)}?${params.toString()}`,
    body: { ttl },
    fetchFn,
  });
  return interpretSubscriptionOperation(op);
}

export async function deleteSubscription(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<{ done: boolean; operationName: string }> {
  const op = await googleJsonRequest<WorkspaceEventsOperation<Record<string, never>>>({
    accessToken,
    method: "DELETE",
    url: `${WORKSPACE_EVENTS_API_BASE}/${encodeResourcePath(name)}`,
    fetchFn,
  });
  if (op?.error) {
    throw new GoogleApiError({
      httpStatus: op.error.code ?? 500,
      apiStatus: op.error.status,
      apiMessage: op.error.message ?? "Workspace Events 購読削除に失敗しました",
    });
  }
  return {
    done: Boolean(op?.done),
    operationName: op?.name ?? "",
  };
}

export async function reactivateSubscription(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<SubscriptionOperationResult> {
  const op = await googleJsonRequest<WorkspaceEventsOperation<WorkspaceEventSubscription>>({
    accessToken,
    method: "POST",
    url: `${WORKSPACE_EVENTS_API_BASE}/${encodeResourcePath(name)}:reactivate`,
    body: {},
    fetchFn,
  });
  return interpretSubscriptionOperation(op);
}
