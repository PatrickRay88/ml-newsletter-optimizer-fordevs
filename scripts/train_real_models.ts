import "dotenv/config";
import { trainRealModels } from "../lib/train_real_models";

async function main() {
  const summary = await trainRealModels();
  console.log(JSON.stringify({ success: true, summary }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown training failure";
  console.error(JSON.stringify({ success: false, message }, null, 2));
  process.exit(1);
});
