// server/index.ts
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`Terra Arbitrage API listening on http://localhost:${port}`);
});
