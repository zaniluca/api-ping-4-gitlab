import express from "express";
import "dotenv/config";
import user from "./routes/user";
import notification from "./routes/notification";
import auth from "./routes/auth";
import webhook from "./routes/webhook";
import { handleError, logError } from "./middlewares";
import { expressjwt } from "express-jwt";

const app = express();
const port = process.env.PORT ?? 8080;

// Middlewares
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

app.get("/health", (_req, res) => res.send("OK"));

// Error handling
app.use(logError);
app.use(handleError);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;
