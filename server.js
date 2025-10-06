const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Facebook API Configuration
const ACCESS_TOKEN =
  "EAAQBdOPIdZA4BPtcr4UJpZCwKC8rTqZAjUhcGyTdAAcxHZBqJhs6e2JcCQJFvJJEf1ZBZAGRnOERnTTHGoNnEysyoMn37lEZCeRHIzswqxbUjjD9ZAQvocd5EC9d8tEMJvAVVCMlHZC0IMiFWoMtqEX25A99c6rhgXENc0tSji8sHjmK5SKsDJ37C6ayHmaZA2zfFYAcUgghYZD";

// MongoDB connection
const MONGODB_URI =
  "mongodb+srv://octaldaksh:octal123@cluster0.5xt6n.mongodb.net/facebook_data";

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve static files
app.use(express.static("."));

// Connect to MongoDB
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Connected to MongoDB successfully");
  })
  .catch((error) => {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  });

// Post Schema
const commentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    fromName: { type: String, required: true },
    message: { type: String, default: "" },
    created_time: { type: String, required: true },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    url: { type: String },
    type: { type: String },
    title: { type: String },
    description: { type: String },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema({
  postId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  message: { type: String, default: "" },
  created_time: { type: String, required: true },
  commentCount: { type: Number, default: 0 },
  comments: [commentSchema],
  attachments: [attachmentSchema],
  lastUpdated: { type: Date, default: Date.now },
});

const Post = mongoose.model("Post", postSchema, "my_posts");

// Helper function to convert markdown formatting to HTML
function convertMarkdownToHtml(text) {
  if (!text) return text;

  return (
    text
      // Convert **bold** to <strong>bold</strong>
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      // Convert *italic* to <em>italic</em>
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      // Convert line breaks to <br>
      .replace(/\n/g, "<br>")
      // Clean up any remaining asterisks
      .replace(/\*/g, "")
  );
}

// Helper function to fetch ALL comments for a post from Facebook API
async function fetchAllCommentsForPost(postId) {
  const allComments = [];
  let nextUrl = `https://graph.facebook.com/v23.0/${postId}/comments?fields=from,message,created_time&access_token=${ACCESS_TOKEN}`;

  try {
    while (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) {
        console.error(
          `❌ Failed to fetch comments for post ${postId}: ${response.status} ${response.statusText}`
        );
        break;
      }

      const data = await response.json();

      // Add comments from this page
      if (data.data && Array.isArray(data.data)) {
        const commentsData = data.data.map((c) => ({
          id: c.id,
          fromName: (c.from && c.from.name) || "Unknown",
          message: c.message || "",
          created_time: c.created_time,
        }));
        allComments.push(...commentsData);
      }

      // Check if there's a next page
      nextUrl = data.paging && data.paging.next ? data.paging.next : null;
    }

    console.log(`✅ Fetched ${allComments.length} comments for post ${postId}`);
  } catch (error) {
    console.error(
      `❌ Error fetching comments for post ${postId}:`,
      error.message
    );
  }

  return allComments;
}

// API Routes

// Save or update posts
app.post("/api/posts", async (req, res) => {
  try {
    const { posts } = req.body;

    if (!posts || !Array.isArray(posts)) {
      return res.status(400).json({
        success: false,
        error: "Posts array is required",
      });
    }

    const results = [];

    for (const postData of posts) {
      try {
        // Fetch ALL comments directly from Facebook API for this post
        console.log(
          `🔍 Fetching comments from Facebook API for post ${postData.id}...`
        );
        const allComments = await fetchAllCommentsForPost(postData.id);

        // Prepare post document
        const postDoc = {
          postId: postData.id,
          message: postData.message || "",
          created_time: postData.created_time,
          commentCount: allComments.length, // Use actual fetched count
          comments: allComments,
          attachments: postData.attachments || [],
          lastUpdated: new Date(),
        };

        // Use findOneAndUpdate with upsert to insert or update
        const result = await Post.findOneAndUpdate(
          { postId: postData.id },
          postDoc,
          {
            upsert: true,
            new: true,
            runValidators: true,
          }
        );

        results.push({
          postId: postData.id,
          success: true,
          operation: result.isNew ? "created" : "updated",
        });
      } catch (postError) {
        console.error(`Error processing post ${postData.id}:`, postError);
        results.push({
          postId: postData.id,
          success: false,
          error: postError.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.length - successCount;

    res.json({
      success: errorCount === 0,
      message: `Processed ${results.length} posts. ${successCount} successful, ${errorCount} failed.`,
      results: results,
    });
  } catch (error) {
    console.error("Error in /api/posts:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error: " + error.message,
    });
  }
});

// Get all posts
app.get("/api/posts", async (req, res) => {
  try {
    const posts = await Post.find({}).sort({ created_time: -1 });
    res.json({
      success: true,
      posts: posts,
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch posts: " + error.message,
    });
  }
});

// Analyze comments using Gemini API
app.post("/api/analyze-comments", async (req, res) => {
  try {
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({
        success: false,
        error: "Post ID is required",
      });
    }

    // Fetch post from MongoDB
    const post = await Post.findOne({ postId });

    if (!post) {
      return res.status(404).json({
        success: false,
        error: "Post not found",
      });
    }

    // Extract comment messages
    const commentTexts = post.comments
      .map((c) => c.message)
      .filter((msg) => msg && msg.trim().length > 0);

    if (commentTexts.length === 0) {
      return res.json({
        success: true,
        summary: "No text comments available to analyze.",
      });
    }

    // Call OpenAI API

    // Use Ollama Local API
    const ollamaUrl = "http://localhost:11434/api/generate";
    const prompt = `Analyze the following ${
      commentTexts.length
    } comments from a social media post and provide a concise 5-6 line summary highlighting the main themes, sentiments, and key points:\n\n${commentTexts.join(
      "\n\n"
    )}\n\nProvide a brief, insightful summary in 5-6 lines.`;

    let summary = "Unable to generate summary.";
    try {
      const ollamaResponse = await fetch(ollamaUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-oss:120b-cloud",
          prompt: prompt,
          stream: false,
        }),
      });

      if (!ollamaResponse.ok) {
        const errorData = await ollamaResponse.json();
        console.error("Ollama API error:", errorData);
        return res.status(500).json({
          success: false,
          error: "Failed to analyze comments with Ollama API",
        });
      }

      const ollamaData = await ollamaResponse.json();
      const rawSummary = ollamaData?.response || "Unable to generate summary.";
      summary = convertMarkdownToHtml(rawSummary);
    } catch (err) {
      console.error("Ollama API error:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to analyze comments with Ollama API",
      });
    }

    res.json({
      success: true,
      summary: summary,
      commentCount: commentTexts.length,
    });
  } catch (error) {
    console.error("Error in /api/analyze-comments:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error: " + error.message,
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    mongodb:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// Serve the main HTML file for root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📊 MongoDB Database: facebook_data`);
  console.log(`📁 Collection: my_posts`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🔄 Shutting down gracefully...");
  try {
    await mongoose.connection.close();
    console.log("✅ MongoDB connection closed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
});
