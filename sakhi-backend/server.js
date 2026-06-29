const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

// Load service account
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Test API
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// Add user API
app.post("/add-user", async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection("users").add(data);
    res.send({
      message: "User added",
      id: docRef.id,
    });
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/get-users", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Start server
app.listen(5000, () => {
  console.log("Server running on port 5000");
});