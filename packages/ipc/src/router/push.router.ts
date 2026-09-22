import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import { PushUpcomingInput, PushUpcomingOutput } from "../schemas/push.js";

/** Implémenté par le worker du coffre (`apps/web/src/lib/vault-worker/calendar-routes.ts`). */
export const pushRouter = router({
  upcoming: publicProcedure
    .input(PushUpcomingInput)
    .output(PushUpcomingOutput)
    .query(() => {
      throw notImplemented("push.upcoming");
    }),
});

export type PushRouter = typeof pushRouter;
