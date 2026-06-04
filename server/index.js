import "dotenv/config";
import express from "express";
import cors from "cors";
import { router as enrichRouter } from "./routes/enrich.js";
import { migrate } from "./migrate.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", enrichRouter);

const PORT = process.env.PORT || 3001;

migrate()
  .then(() => app.listen(PORT, () => console.log(`Server on :${PORT}`)))
  .catch((e) => {
    console.error("Migration failed:", e.message);
    process.exit(1);
  });
