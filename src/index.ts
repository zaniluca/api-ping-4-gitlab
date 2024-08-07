import express from "express";
import "dotenv/config";
import user from "./routes/user";
import notification from "./routes/notification";
import oauth from "./routes/oauth";
import auth from "./routes/auth";
import webhook from "./routes/webhook";
import {
  attachSentryUserInfo,
  handleError,
  logError,
  requestLogger,
} from "./middlewares";
import { expressjwt } from "express-jwt";
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import * as Profiling from "@sentry/profiling-node";
import { RewriteFrames } from "@sentry/integrations";
import prisma from "../prisma/client";
import { oldNotificationDeletionCron } from "./crons";

const app = express();
const port = process.env.PORT ?? 8080;

app.enable("trust proxy");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  debug: process.env.NODE_ENV === "development",
  enabled: process.env.NODE_ENV === "production",
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Prisma({ client: prisma }),
    new Tracing.Integrations.Express({
      app,
    }),
    new Profiling.ProfilingIntegration(),
    // RewriteFrames is needed to show the correct source code in Sentry when using TypeScript
    new RewriteFrames({
      // Why process.cwd() instead of global.__dirname ?: https://stackoverflow.com/a/63848735/12661017
      root: process.cwd(),
    }),
  ],
  tracesSampleRate: 0.33,
  profilesSampleRate: 0.33,
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
});

// Middlewares
// The request handler must be the first middleware on the app
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());
app.use(requestLogger);
app.use(attachSentryUserInfo);
app.use(express.json());
app.use(
  "/user",
  expressjwt({
    secret: process.env.JWT_ACCESS_SECRET!,
    algorithms: ["HS256"],
  }),
);
app.use(
  "/notification",
  expressjwt({
    secret: process.env.JWT_ACCESS_SECRET!,
    algorithms: ["HS256"],
  }),
);

// Routes
app.use("/user", user);
app.use("/oauth", oauth);
app.use("/notification", notification);
app.use("/", auth);
app.use("/", webhook);
app.get("/health", (_req, res) => res.send("OK"));
app.get("/account-deletion-info", (_req, res) =>
  res.send(
    "If you want to get your account deleted you can either enter the app and delete your account in the settings screen or send an email to support@zaniluca.com with the subject 'Delete my account' along with the credentials you used to sign up.",
  ),
);

// Error handling
app.use(
  Sentry.Handlers.errorHandler({
    shouldHandleError: (error) => error.status === 500,
  }),
);
app.use(logError);
app.use(handleError);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    oldNotificationDeletionCron.start();
  });
}

export default app;
