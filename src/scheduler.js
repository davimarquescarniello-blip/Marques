export function startExpirationScheduler(botManager) {
  console.log('⏰ Scheduler de expiração iniciado (a cada 5 minutos)');

  const interval = setInterval(async () => {
    try {
      await botManager.cleanupExpired();
    } catch (e) {
      console.error('❌ Erro no scheduler de expiração:', e.message);
    }
  }, 5 * 60 * 1000);

  process.on('SIGINT', () => clearInterval(interval));
  process.on('SIGTERM', () => clearInterval(interval));

  return interval;
}
