import * as Sentry from "@sentry/cloudflare";
import { count, lt } from "drizzle-orm";
import { getDrizzleClient } from "./db/client";
import { notifications } from "./db/schema";
import { AppEnv } from "./utils/types";

const EVERY_DAY_AT_MIDNIGHT_CRON = "0 0 * * *";

export async function deleteOldNotifications(env: AppEnv["Bindings"]) {
  const db = getDrizzleClient(env.DB);

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  try {
    const [deleted] = await db
      .delete(notifications)
      .where(lt(notifications.recived, twoYearsAgo))
      .returning({ count: count() });

    console.log(`Deleted ${deleted.count} old notifications`);
  } catch (error) {
    console.error("Error deleting old notifications:", error);
    Sentry.withScope((scope) => {
      scope.setTag("cron", true);
      scope.setContext("Cron", {
        name: "oldNotificationDeletionCron",
        schedule: EVERY_DAY_AT_MIDNIGHT_CRON,
      });
      scope.setExtra("date", twoYearsAgo);
      Sentry.captureException(error);
    });
  }
}
