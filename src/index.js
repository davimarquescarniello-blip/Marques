import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { BotManager } from './botManager.js';
import { startServer } from './server.js';
import { startExpirationScheduler } from './scheduler.js';
import { createBot } from './bot-core.js';

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ unhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err?.message || err);
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const botManager = new BotManager({ createBot, supabase });

async function main() {
  console.log('🚀 Iniciando MQS Bot Vendas Multi-Bot SaaS...');

  // 1. Start web server
  startServer({ botManager, supabase, port: process.env.PORT || 3000 });

  // 2. Start expiration scheduler
  startExpirationScheduler(botManager);

  // 3. Load and start all bots from database
  await botManager.loadAllBotsFromDatabase();

  console.log('✅ Sistema Multi-Bot inicializado com sucesso!');
}

main().catch(err => {
  console.error('❌ Erro fatal no main():', err?.message || err);
  process.exit(1);
});
