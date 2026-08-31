import "dotenv/config";
import { createApp } from "./app.js";
import { MsalMicrosoftAuthClient } from "./auth/microsoft-auth-client.js";
import { loadConfig } from "./config.js";

try {
  const config = loadConfig();
  const microsoftAuthClient = new MsalMicrosoftAuthClient(config);
  const app = createApp({ config, microsoftAuthClient });

  app.listen(config.port, () => {
    console.log(`EduPath API listening on http://localhost:${config.port}`);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`EduPath API could not start: ${message}`);
  process.exitCode = 1;
}

