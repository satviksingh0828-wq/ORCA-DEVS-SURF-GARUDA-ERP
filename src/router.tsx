import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { makeQueryClient } from "./lib/query-persist";
import { ModuleLoadingScreen } from "./components/ModuleLoadingScreen";

export const getRouter = () => {
  const queryClient = makeQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: ModuleLoadingScreen,
    defaultPendingMs: 200,
    defaultPendingMinMs: 250,
  });

  return router;
};
