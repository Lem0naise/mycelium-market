// server/api/consult.ts
import { Request, Response } from 'express';
import { ElevenLabsClient } from "elevenlabs"; // npm install elevenlabs

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

export const handleConsult = async (req: Request, res: Response) => {
  const { ticker } = req.body;

  try {
    const script = `The ${ticker} market is shifting. The mycelium suggests action.`;

    // 1. Generate the audio stream
    const audioStream = await elevenlabs.generate({
      voice: "y77VZ9S42ETwXAX9jZ1W",
      text: script,
      model_id: "eleven_multilingual_v2",
      stream: true, // Ensure streaming is enabled
    });

    // 2. Set headers
    res.setHeader('Content-Type', 'audio/mpeg');

    // 3. Consume the stream and write to response
    // For Web Streams, iterate and write to the Express response
    for await (const chunk of audioStream) {
      res.write(chunk);
    }
    
    res.end();

  } catch (error) {
    console.error("Fungal network error:", error);
    res.status(500).send("The network is dormant.");
  }
};