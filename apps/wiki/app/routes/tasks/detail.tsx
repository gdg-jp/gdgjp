import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { buildPageMeta } from "~/features/pages/meta";
import { TaskListView } from "~/features/tasks/components/TaskListView";
import { handleTaskDetailAction, loadTaskDetail } from "~/features/tasks/task-detail.server";

export const meta: MetaFunction<typeof loader> = ({ data, location, matches }) => {
  if (!data) return [{ title: "Tasks" }];

  const origin = (matches.find((match) => match.id === "root")?.data as { origin?: string })
    ?.origin;

  return buildPageMeta({
    title: data.page.titleJa || data.page.titleEn,
    description: data.page.summaryJa || data.page.summaryEn,
    visibility: data.page.visibility,
    origin: origin ?? "",
    pathname: location.pathname,
  });
};

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  return loadTaskDetail(request, context.cloudflare.env, params.slug);
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  return handleTaskDetailAction(request, context.cloudflare.env, params.slug);
}

export default function TaskDetailRoute() {
  return <TaskListView />;
}
