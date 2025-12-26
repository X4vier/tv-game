import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

import { type AppRouter } from "~/server/api/root";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

let trpcClient: ReturnType<typeof createTRPCClient<AppRouter>> | undefined;

export function getTrpcClient() {
  if (typeof window === "undefined") {
    throw new Error("getTrpcClient must be called on the client side");
  }
  trpcClient ??= createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        transformer: SuperJSON,
        url: getBaseUrl() + "/api/trpc",
      }),
    ],
  });
  return trpcClient;
}
