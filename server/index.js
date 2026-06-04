import "dotenv/config";
import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { router as enrichRouter } from "./routes/enrich.js";
import { migrate } from "./migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", enrichRouter);

// Serve the built React app in production.
app.use(express.static(join(__dirname, "../dist")));
app.get("*", (_req, res) => res.sendFile(join(__dirname, "../dist/index.html")));

const PORT = process.env.PORT || 3001;

migrate()
  .then(() => app.listen(PORT, () => console.log(`Server on :${PORT}`)))
  .catch((e) => {
    console.error("Migration failed:", e.message);
    process.exit(1);
  });
