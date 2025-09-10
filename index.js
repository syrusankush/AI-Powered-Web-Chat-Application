// index.js
const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const http = require("http");

// Routes
const userRoutes = require("./Routes/userRoutes");
const chatRoutes = require("./Routes/chatRoutes");
const messageRoutes = require("./Routes/messageRoutes");
const aiRoutes = require("./Routes/aiRoutes");

// Controllers
const { generateAIReply } = require("./Controllers/aiController");
const Message = require("./modals/messageModel");

dotenv.config();
console.log("HF API Key:", process.env.HF_API_KEY);
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("DB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/user", userRoutes);
app.use("/chat", chatRoutes);
app.use("/message", messageRoutes);
app.use("/ai", aiRoutes);

// Test route
app.get("/", (req, res) => res.send("API Running..."));

// Start server
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // Join personal room
  socket.on("setup", (user) => {
    if (!user?._id) return;
    socket.join(user._id);
    socket.emit("connected");
  });

  // Join chat room
  socket.on("join chat", (chatId) => {
    if (!chatId) return;
    socket.join(chatId);
    console.log(`User joined chat: ${chatId}`);
  });

  // Handle new message
  socket.on("new message", async (msg) => {
    const chat = msg?.chat;
    if (!chat?.users || !msg?.sender?._id) return;

    // Emit message to all users except sender
    chat.users.forEach((user) => {
      if (user._id !== msg.sender._id) {
        io.to(user._id).emit("message received", msg);
      }
    });

    // Check if AI is in chat
    const aiUserEmail = process.env.AI_USER_EMAIL;
    const aiUser = chat.users.find((u) => u.email === aiUserEmail);

    if (aiUser && msg.sender._id !== aiUser._id) {
      try {
        // Generate AI response
        const aiContent = await generateAIReply(msg.content);

        // Save AI message
        const aiMessage = await Message.create({
          sender: aiUser._id,
          content: aiContent,
          chat: chat._id,
        });

        await aiMessage.populate("sender", "name email");
        await aiMessage.populate("chat");

        // Emit AI message to chat room
        io.to(chat._id).emit("message received", aiMessage);
      } catch (error) {
        console.error("AI reply error:", error.message);
      }
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
