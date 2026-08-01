import express from "express";
import { registerUser, loginUser , getMe ,updateMe  } from "../controllers/auth.js";
import { protect } from "../middleware/authMiddleware.js";
import { Searchuserbyphone } from "./searchuserbyphone.js";

const router = express.Router();


export default router;
