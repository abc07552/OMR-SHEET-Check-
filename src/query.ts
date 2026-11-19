import { QueryClient } from "@tanstack/react-query";

// Memory-only queries. Private API responses are NEVER cached by the service worker.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
