const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const session = require("express-session");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://127.0.0.1:8080",
      "http://localhost:8080",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:3000",
      process.env.FRONTEND_URL,
    ].filter(Boolean), // Remove any undefined values
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error("Error connecting to database:", err);
  } else {
    console.log("Connected to PostgreSQL database");
    release();
  }
});

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
};

// Routes

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// User Registration
app.post("/api/register", async (req, res) => {
  try {
    const { username, password, group } = req.body;

    // Validation
    if (!username || !password || !group) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (username.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    // Check if username already exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username.trim()],
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await pool.query(
      "INSERT INTO users (username, password, group_name) VALUES ($1, $2, $3) RETURNING id, username, group_name",
      [username.trim(), hashedPassword, group.trim().toUpperCase()],
    );

    res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    // Find user
    const result = await pool.query(
      "SELECT id, username, password, group_name FROM users WHERE username = $1",
      [username.trim()],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        group: user.group_name,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out" });
    }
    res.json({ message: "Logout successful" });
  });
});

// Get current user profile
app.get("/api/user/profile", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, group_name FROM users WHERE id = $1",
      [req.session.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Change password
app.put("/api/user/password", requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      req.session.userId,
    ]);

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Change group
app.put("/api/user/group", requireAuth, async (req, res) => {
  try {
    const { newGroup } = req.body;

    if (!newGroup || newGroup.trim().length === 0) {
      return res.status(400).json({ error: "Group name cannot be empty" });
    }

    await pool.query("UPDATE users SET group_name = $1 WHERE id = $2", [
      newGroup.trim().toUpperCase(),
      req.session.userId,
    ]);

    res.json({ message: "Group updated successfully" });
  } catch (error) {
    console.error("Group change error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add/Update steps for a specific date
app.post("/api/steps", requireAuth, async (req, res) => {
  try {
    const { date, steps } = req.body;

    if (!date || steps === undefined || steps < 0) {
      return res
        .status(400)
        .json({ error: "Valid date and steps (≥0) are required" });
    }

    // Use UPSERT (INSERT ... ON CONFLICT)
    const result = await pool.query(
      `
            INSERT INTO step_logs (user_id, log_date, steps) 
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, log_date) 
            DO UPDATE SET steps = $3, updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
      [req.session.userId, date, parseInt(steps)],
    );

    res.json({
      message: "Steps updated successfully",
      stepLog: result.rows[0],
    });
  } catch (error) {
    console.error("Steps update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user's step log
app.get("/api/steps", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT log_date, steps FROM step_logs WHERE user_id = $1 ORDER BY log_date DESC",
      [req.session.userId],
    );

    // Convert to object format like the frontend expects
    const stepLog = {};
    result.rows.forEach((row) => {
      stepLog[row.log_date.toISOString().split("T")[0]] = row.steps;
    });

    res.json({ stepLog });
  } catch (error) {
    console.error("Get steps error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get individual leaderboard
app.get("/api/leaderboard/individual", async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT 
                u.username,
                u.group_name,
                COALESCE(SUM(sl.steps), 0) as total_steps
            FROM users u
            LEFT JOIN step_logs sl ON u.id = sl.user_id
            GROUP BY u.id, u.username, u.group_name
            ORDER BY total_steps DESC
        `);

    res.json({ leaderboard: result.rows });
  } catch (error) {
    console.error("Individual leaderboard error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get group leaderboard
app.get("/api/leaderboard/group", async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT 
                u.group_name,
                SUM(COALESCE(sl.steps, 0)) as total_steps,
                COUNT(DISTINCT u.id) as member_count
            FROM users u
            LEFT JOIN step_logs sl ON u.id = sl.user_id
            GROUP BY u.group_name
            ORDER BY total_steps DESC
        `);

    res.json({ leaderboard: result.rows });
  } catch (error) {
    console.error("Group leaderboard error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Clear individual leaderboard (reset all users' steps to 0)
app.delete("/api/leaderboard/individual", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM step_logs");
    res.json({ message: "Individual leaderboard cleared successfully" });
  } catch (error) {
    console.error("Clear individual leaderboard error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Clear group leaderboard (same as individual since groups are derived from users)
app.delete("/api/leaderboard/group", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM step_logs");
    res.json({ message: "Group leaderboard cleared successfully" });
  } catch (error) {
    console.error("Clear group leaderboard error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Check authentication status
app.get("/api/auth/check", (req, res) => {
  if (req.session.userId) {
    res.json({
      authenticated: true,
      username: req.session.username,
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
