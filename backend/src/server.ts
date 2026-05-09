import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8787);

createApp().listen(port, () => {
  console.log(`WebRelay backend listening on http://localhost:${port}`);
});
