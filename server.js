import "./config/loadEnv.js";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import subscriptionAccessRoutes from "./routes/subscriptionAccessRoutes.js";
import adminRoutes from "./routes/admin.js";
import smsRoutes from "./routes/smsRoutes.js";
import quizRouter from "./routes/quizRoutes.js";
import mtnpaymentrouter from "./routes/mtnpayementStatusRoutes.js";
import mtnsearchnumberrouter from "./routes/mtnsearchbynuimber.js";
import cgwRoutes from "./routes/cgwRoutes.js";
import headerEnrichment from "./middleware/headerEnrichment.js";
import {
  generateCGWRedirectUrl,
  handleCGWCallback,
  startHeaderEnrichmentRedirect,
} from "./controllers/cgwController.js";
import { logUnsubscribe } from "./utils/unsubscribeLog.js";
import { isHeRedirectRequest } from "./utils/heRedirectPath.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.resolve(
  process.env.PUBLIC_DIR || path.join(__dirname, "public")
);

connectDB();

const staticAllowedOrigins = [
  process.env.FRONTEND_BASE_URL,
  "https://ghsuperwinnings.com",
  "https://www.ghsuperwinnings.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
].filter(Boolean);

const isLocalDevOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

app.set("trust proxy", 1);

const handleHeRedirect = (req, res, next) =>
  startHeaderEnrichmentRedirect(req, res, next);

["get", "head", "post"].forEach((method) => {
  app[method]("/api/cgw/he-redirect", handleHeRedirect);
  app[method]("/cgw/he-redirect", handleHeRedirect);
  app[method]("/he-redirect", handleHeRedirect);
  app[method]("/api/he-redirect", handleHeRedirect);
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || staticAllowedOrigins.includes(origin) || isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      console.warn("[CORS] Blocked origin:", origin);
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const url = String(req.originalUrl || req.url || "");
  const shouldLog =
    req.method !== "GET" ||
    url.includes("/api/subscription") ||
    url.toLowerCase().includes("unsubscribe") ||
    url.includes("/api/sms") ||
    url.includes("/api/auth");

  if (url.startsWith("/api") && shouldLog) {
    logUnsubscribe("incoming", {
      method: req.method,
      url,
      hasAuth: Boolean(req.headers.authorization),
    });
  }
  next();
});
app.use(headerEnrichment);

app.use((req, res, next) => {
  if (!isHeRedirectRequest(req)) return next();
  return startHeaderEnrichmentRedirect(req, res, next);
});

app.use("/api/auth", authRoutes);
app.use("/api/quiz", quizRouter);
app.use("/api/sms", smsRoutes);
app.use("/api/subscription", subscriptionAccessRoutes);
app.use("/api/mtn/payment", mtnpaymentrouter);
app.use("/api/mtn/details", mtnsearchnumberrouter);
app.all("/api/callback", handleCGWCallback);
app.get("/api/cgw/he", startHeaderEnrichmentRedirect);
app.get("/api/cgw/redirect", generateCGWRedirectUrl);
app.all("/api/cgw/redirect", generateCGWRedirectUrl);
app.all("/cgw/redirect", generateCGWRedirectUrl);
app.use("/api/cgw", cgwRoutes);
app.use("/cgw", cgwRoutes);
app.use("/api/admin", adminRoutes);
app.use("/admin-api", adminRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "ghsuperwinnings-api",
    heRedirect: true,
    timestamp: new Date().toISOString(),
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(
    express.static(publicDirectory, {
      maxAge: "1d",
      index: false,
    })
  );

  app.use((req, res, next) => {
    if (
      req.method === "GET" &&
      !req.path.startsWith("/api/") &&
      req.accepts("html")
    ) {
      return res.sendFile(path.join(publicDirectory, "index.html"));
    }
    return next();
  });
} else {
  app.get("/", (req, res) => {
    res.send("Server is running");
  });
}

app.use((error, req, res, next) => {
  console.error("Unhandled request error:", error);
  if (res.headersSent) return next(error);
  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, "0.0.0.0", () => {
  logUnsubscribe("ready", {
    port: PORT,
    pid: process.pid,
    provider: process.env.MTN_SUBSCRIPTION_PROVIDER_ID || "-",
    subscriptionId:
      process.env.MTN_SUBSCRIPTION_ID || process.env.CGW_INITIAL_OFFER_CODE || "-",
    skip: process.env.MTN_UNSUBSCRIBE_SKIP || "false",
  });
  console.log(`Server running on http://localhost:${PORT}`);
});


