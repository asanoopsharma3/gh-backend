import User from "../models/User.js";  // Make sure to add .js if you're using ES Modules

export const Searchuserbyphone = async (req, res) => {
  try {
    const { phone } = req.body; 

    if (!phone) {
      return res.status(400).json({
        message: "Phone number is required",
        data: {},
        status: 400,
        error: {},
      });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        data: {},
        status: 404,
        error: {},
      });
    }

    return res.status(200).json({
      message: "User found successfully",
      data: user,
      status: 200,
      error: {},
    });

  } catch (error) {
    console.error("Error in finding user by phone:", error);
    return res.status(500).json({
      message: "Error finding user by phone",
      data: {},
      status: 500,
      error,
    });
  }
};
