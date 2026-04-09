const express = require("express");
const cors = require("cors");
const { connectDB } = require("./utils/db"); // Import DB
const authRoutes = require("./routes/auth");
const driveRoutes = require("./routes/drive");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Connexion BDD
connectDB();

app.use(
  cors({
    exposedHeaders: ["Content-Disposition"], // Allows frontend to read the filename
  }),
);
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/drive", driveRoutes);
app.use("/api", driveRoutes); // Pour la route share publique
 
const startServer = async () => {
  try {
    await connectDB(); // On attend que la connexion soit établie

    app.listen(PORT, () => {
      console.log(`Serveur démarré sur port ${PORT}`);
    });
  } catch (error) {
    console.error("Impossible de démarrer le serveur car la BDD est inaccessible");
    process.exit(1);
  }
};

startServer();
