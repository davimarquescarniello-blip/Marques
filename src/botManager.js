import { decrypt } from './crypto.js';

export class BotManager {
  constructor({ createBot, supabase }) {
    this.createBot = createBot;
    this.supabase = supabase;
    this.instances = new Map();
    this.startQueue = [];
    this.queued = false;
  }

  async loadAllBotsFromDatabase() {
    const { data: clients, error } = await this.supabase
      .from('clients')
      .select('*')
      .eq('active', true);

    if (error) {
      console.error('❌ Erro ao carregar clientes do Supabase:', error.message);
      return;
    }

    if (!clients?.length) {
      console.log('ℹ️ Nenhum cliente ativo encontrado.');
      return;
    }

    console.log(`📋 Encontrados ${clients.length} cliente(s) ativo(s). Iniciando fila...`);

    for (const client of clients) {
      this.startQueue.push(client);
    }

    await this._processQueue();
  }

  async _processQueue() {
    if (this.queued) return;
    this.queued = true;

    while (this.startQueue.length > 0) {
      const clientData = this.startQueue.shift();
      await this._startSingleBot(clientData);
      const delay = Math.floor(Math.random() * 3000) + 2000;
      await new Promise(r => setTimeout(r, delay));
    }

    this.queued = false;
  }

  async _startSingleBot(clientData) {
    const { id: clientId, bot_token: encryptedToken, server_id: guildId } = clientData;

    if (this.instances.has(clientId)) {
      console.log(`⚠️ Bot ${clientId} já está rodando.`);
      return;
    }

    let token;
    try {
      token = decrypt(encryptedToken);
    } catch (e) {
      console.error(`❌ Erro ao descriptografar token do cliente ${clientId}:`, e.message);
      await this._log(clientId, 'error', `Falha ao descriptografar token: ${e.message}`);
      return;
    }

    try {
      const client = await this.createBot(token, { supabase: this.supabase, botManager: this, clientId });
      this.instances.set(clientId, { client, clientData });

      client.on('error', (err) => {
        console.error(`⚠️ Erro no bot ${clientId}:`, err.message);
        this._log(clientId, 'error', `Erro na conexão: ${err.message}`);
      });

      client.once('shardDisconnect', () => {
        console.log(`🔌 Bot ${clientId} desconectado.`);
        this._log(clientId, 'info', 'Bot desconectado do Discord');
      });

      this._log(clientId, 'info', 'Bot iniciado com sucesso');
      console.log(`✅ Bot ${clientId} iniciado com sucesso!`);
    } catch (e) {
      console.error(`❌ Erro ao iniciar bot ${clientId}:`, e.message);
      this._log(clientId, 'error', `Falha ao iniciar: ${e.message}`);
    }
  }

  async startBot(clientId) {
    const { data: clientData } = await this.supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .maybeSingle();

    if (!clientData) throw new Error(`Cliente ${clientId} não encontrado.`);

    if (this.instances.has(clientId)) {
      await this.stopBot(clientId);
      await new Promise(r => setTimeout(r, 2000));
    }

    await this._startSingleBot(clientData);
  }

  async stopBot(clientId) {
    const instance = this.instances.get(clientId);
    if (!instance) return;

    try {
      instance.client.destroy();
    } catch (e) {
      console.error(`Erro ao destruir bot ${clientId}:`, e.message);
    }

    this.instances.delete(clientId);
    this._log(clientId, 'info', 'Bot parado');
    console.log(`🛑 Bot ${clientId} parado.`);
  }

  async restartBot(clientId) {
    await this.stopBot(clientId);
    await new Promise(r => setTimeout(r, 2000));
    await this.startBot(clientId);
  }

  getStatus(clientId) {
    const instance = this.instances.get(clientId);
    if (!instance) return 'offline';
    const state = instance.client.ws.status;
    if (state === 0) return 'online';
    if (state === 1 || state === 2) return 'connecting';
    return 'offline';
  }

  getBotTag(clientId) {
    const instance = this.instances.get(clientId);
    return instance?.client?.user?.tag || null;
  }

  getClientIdFromTag(tag) {
    for (const [id, instance] of this.instances) {
      if (instance.client?.user?.tag === tag) return id;
    }
    return null;
  }

  getAllStatuses() {
    const statuses = {};
    for (const [id] of this.instances) {
      statuses[id] = this.getStatus(id);
    }
    return statuses;
  }

  async syncWithDatabase() {
    if (this.instances.size === 0) return;
    const idsRodando = Array.from(this.instances.keys());
    const { data: ativos } = await this.supabase
      .from('clients')
      .select('id')
      .in('id', idsRodando)
      .eq('active', true);
    const idsAtivos = new Set((ativos || []).map(c => c.id));
    for (const id of idsRodando) {
      if (!idsAtivos.has(id)) {
        console.log(`🗑️ Cliente ${id} removido/inativo. Parando bot...`);
        await this.stopBot(id);
        this._log(id, 'info', 'Cliente removido do banco - bot parado');
      }
    }
  }

  async cleanupExpired() {
    await this.syncWithDatabase();

    const now = new Date().toISOString();
    const { data: expired } = await this.supabase
      .from('clients')
      .select('id')
      .lt('expires_at', now)
      .eq('active', true);

    if (!expired?.length) return;

    for (const client of expired) {
      console.log(`⏰ Cliente ${client.id} expirado. Parando bot...`);
      await this.stopBot(client.id);
      await this.supabase.from('clients').update({ active: false }).eq('id', client.id);
      this._log(client.id, 'expired', 'Cliente expirado - bot desativado');
    }
  }

  async _log(clientId, type, message) {
    try {
      await this.supabase.from('logs').insert({
        client_id: clientId,
        type,
        message,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('Erro ao registrar log:', e.message);
    }
  }
}
