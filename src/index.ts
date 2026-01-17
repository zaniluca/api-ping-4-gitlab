import { Hono } from "hono";
import { logger } from "hono/logger";
import { jwt } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import * as Sentry from "@sentry/cloudflare";
import { attachSentryUserInfo } from "./middlewares";
import { deleteOldNotifications } from "./crons";

import auth from "./routes/auth";
import user from "./routes/user";
import notification from "./routes/notification";
import oauth from "./routes/oauth";
import webhook from "./routes/webhook";
import { AppEnv } from "./utils/types";
import { getDrizzleClient } from "./db/client";

const app = new Hono<AppEnv>();

// Global middlewares
app.use("*", logger());
app.use("*", async (c, next) => {
  c.set("db", getDrizzleClient(c.env.DB));
  await next();
});

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const status = err.status;
    if (status >= 500) {
      if (process.env.NODE_ENV === "test") {
        return c.json({ message: "I'm in test mode" }, 500);
      }

      console.error("Unhandled HTTPException:", err);
      Sentry.captureException(err);
      return c.json({ message: "Oops! Something went wrong" }, status);
    } else {
      return c.json({ message: err.message }, status);
    }
  }

  console.error("Unhandled Exception:", err);
  Sentry.captureException(err);
  return c.json({ message: "Oops! Something went wrong" }, 500);
});

// Public routes
app.route("/", auth);
app.route("/oauth", oauth);
app.route("/", webhook);
app.get("/health", (c) => c.text("OK"));
app.get("/account-deletion-info", (c) =>
  c.text(
    "If you want to get your account deleted you can either enter the app and delete your account in the settings screen or send an email to support@zaniluca.com with the subject 'Delete my account' along with the credentials you used to sign up.",
  ),
);

// Protected routes
const protectedUser = new Hono<AppEnv>();
protectedUser.use("*", async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_ACCESS_SECRET });
  return jwtMiddleware(c, next);
});
protectedUser.use("*", attachSentryUserInfo);
protectedUser.route("/", user);

const protectedNotification = new Hono<AppEnv>();
protectedNotification.use("*", async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_ACCESS_SECRET });
  return jwtMiddleware(c, next);
});
protectedNotification.use("*", attachSentryUserInfo);
protectedNotification.route("/", notification);

app.route("/user", protectedUser);
app.route("/notification", protectedNotification);

// 404 handler
app.notFound((c) => {
  return c.json({ message: "Not Found" }, 404);
});

export const scheduled: ExportedHandlerScheduledHandler<
  AppEnv["Bindings"]
> = async (event, env, ctx) => {
  console.log("Running scheduled event:", event.cron);
  ctx.waitUntil(deleteOldNotifications(env));
};

export const testApp = app;

export default Sentry.withSentry((env: AppEnv["Bindings"]) => {
  return {
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE,
    sendDefaultPii: true,
    enabled: process.env.NODE_ENV === "production",
    tracesSampleRate: 0.05,
    profilesSampleRate: 0.05,
    // This env should be implicitly used by the SDK but let's make it explicit
    environment: env.SENTRY_ENVIRONMENT,
    beforeSendTransaction(event) {
      // Remove the cursor from the transaction
      event.transaction = event.transaction?.replace(
        /cursor=\w+/,
        "cursor={cursor}",
      );

      // Remove the notification id after /notification/ from the transaction
      event.transaction = event.transaction?.replace(
        /\/notification\/\w+\d+/,
        "/notification/{id}",
      );

      return event;
    },
  };
}, app);
