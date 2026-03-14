// server/index.ts
import { createApp } from "./app";
import { handleConsult } from "./api/consult";
// Import your other handlers here
// import { handleMarkets } from "./api/markets"; 

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

// Add this before your routes
app.use((req, res, next) => {
  console.log(`[DEBUG] Request: ${req.method} ${req.url}`);
  next();
});

// IMPORTANT: Mount all routes
app.post('/api/consult', handleConsult);
// app.get('/api/markets', handleMarkets);
// app.get('/api/signals', handleSignals);

app.listen(port, () => {
  console.log(`Terra Arbitrage API listening on http://localhost:${port}`);
});