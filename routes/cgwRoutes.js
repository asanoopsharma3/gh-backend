import express from "express";
import {
  activateCGWSubscription,
  generateCGWRedirectUrl,
  handleCGWCallback,
  startHeaderEnrichmentRedirect,
} from "../controllers/cgwController.js";
import { validateCallbackRequest } from "../middleware/validateCallbackRequest.js";

const router = express.Router();

router.post("/activate", validateCallbackRequest, activateCGWSubscription);
router.use((req, res, next) => {
  const path = String(req.path || "").replace(/\/+$/, "");
  if (path === "/he-redirect" || path === "/he") {
    return startHeaderEnrichmentRedirect(req, res, next);
  }
  next();
});
router.get("/redirect", generateCGWRedirectUrl);
router.all("/redirect", generateCGWRedirectUrl);
// CGW browser callbacks do not send the SDP shared secret.
router.all("/callback", handleCGWCallback);

export default router;


