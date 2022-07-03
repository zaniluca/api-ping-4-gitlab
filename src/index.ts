import express from "express";
import dotenv from "dotenv";
import user from "./routes/user";
import auth from "./routes/auth";
import { handleUnauthorizedError } from "./middlewares";
import { expressjwt } from "express-jwt";

dotenv.config();

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
app.use("/", auth);

// Error handling
app.use(handleUnauthorizedError);

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
