// // adminRoutes.js
// import express from "express";
// const router = express.Router();

// // Admin login route
// router.post("/login", (req, res) => {
//   const { email, password } = req.body;

//   if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
//     return res.json({ success: true, message: "Login successful" });
//   } else {
//     return res.status(401).json({ success: false, message: "Invalid credentials" });
//   }
// });

// export default router;
