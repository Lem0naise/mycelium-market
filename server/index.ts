// server/index.ts
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`Mycelium Market API listening on http://localhost:${port}`);
});
