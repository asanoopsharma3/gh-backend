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
router.all("/he-redirect", startHeaderEnrichmentRedirect);
router.all("/he", startHeaderEnrichmentRedirect);
router.all("/redirect", generateCGWRedirectUrl);
// CGW browser callbacks do not send the SDP shared secret.
router.all("/callback", handleCGWCallback);

export default router;


