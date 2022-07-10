import express from "express";
import dotenv from "dotenv";
import user from "./routes/user";
import notification from "./routes/notification";
import auth from "./routes/auth";
import webhook from "./routes/webhook";
import { handleErrorWithStatus, handleUnauthorizedError } from "./middlewares";
import { expressjwt } from "express-jwt";
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 8080;

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Express({
      app,
    }),
  ],
  tracesSampleRate: 0.75,
});

// Middlewares
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());
app.use(express.json());
app.use(
  "/user",
  expressjwt({
    secret: process.env.JWT_ACCESS_SECRET!,
    algorithms: ["HS256"],
  })
);

// Routes
app.use("/user", user);
app.use("/notification", notification);
app.use("/", auth);
app.use("/", webhook);

// Error handling
app.use(Sentry.Handlers.errorHandler());
app.use(handleUnauthorizedError);
app.use(handleErrorWithStatus);

app.get("/health", (_req, res) => res.sendStatus(200).end());

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
