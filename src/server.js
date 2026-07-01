import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { encrypt, decrypt } from './crypto.js';
import { getPayment } from './mercadopago.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'mqs-jwt-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

export function startServer({ botManager, supabase, port = 3000 }) {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // --- AUTH ---
  function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  }

  function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }
    try {
      req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
  }

  function adminOnly(req, res, next) {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso restrito a administradores' });
    next();
  }

  app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Credenciais obrigatórias' });

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = generateToken({ username, isAdmin: true });
      return res.json({ token, user: { username, isAdmin: true } });
    }

    const { data: client } = await supabase.from('clients').select('*').eq('username', username).maybeSingle();
    if (!client) return res.status(401).json({ error: 'Credenciais inválidas' });

    const validPass = client.password_hash ? await bcrypt.compare(password, client.password_hash) : (password === client.plain_password);
    if (!validPass) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = generateToken({ id: client.id, username: client.username, isAdmin: false });
    res.json({ token, user: { id: client.id, username: client.username, isAdmin: false } });
  });

  app.get('/auth/me', authMiddleware, (req, res) => {
    res.json(req.user);
  });

  // --- CLIENTS (admin only) ---
  app.get('/clients', authMiddleware, adminOnly, async (req, res) => {
    const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const safeData = data.map(c => ({
      ...c,
      bot_token: c.bot_token ? '🔒' : null,
      password_hash: undefined
    }));
    res.json(safeData);
  });

  app.post('/clients', authMiddleware, adminOnly, async (req, res) => {
    const { discord_user_id, server_id, bot_token, plan, username, password } = req.body;
    if (!bot_token) return res.status(400).json({ error: 'Token do bot é obrigatório' });

    let encryptedToken;
    try {
      encryptedToken = encrypt(bot_token);
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao criptografar token' });
    }

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabase.from('clients').insert({
      discord_user_id: discord_user_id || null,
      server_id: server_id || null,
      bot_token: encryptedToken,
      plan: plan || 'basic',
      active: true,
      username: username || null,
      password_hash: passwordHash,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString()
    }).select().maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    try {
      await botManager.startBot(data.id);
    } catch (e) {
      console.error(`Erro ao iniciar bot do cliente ${data.id}:`, e.message);
    }

    res.status(201).json({ ...data, bot_token: '🔒' });
  });

  app.get('/clients/:id', authMiddleware, async (req, res) => {
    const query = supabase.from('clients').select('*').eq('id', req.params.id).maybeSingle();
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Cliente não encontrado' });

    if (!req.user.isAdmin && req.user.id !== data.id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json({ ...data, bot_token: '🔒' });
  });

  app.put('/clients/:id', authMiddleware, adminOnly, async (req, res) => {
    const { discord_user_id, server_id, bot_token, plan, active, expires_at, username, password } = req.body;
    const updates = {};

    if (discord_user_id !== undefined) updates.discord_user_id = discord_user_id;
    if (server_id !== undefined) updates.server_id = server_id;
    if (plan !== undefined) updates.plan = plan;
    if (active !== undefined) updates.active = active;
    if (expires_at !== undefined) updates.expires_at = expires_at;
    if (username !== undefined) updates.username = username;
    if (password) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }
    if (bot_token) {
      try {
        updates.bot_token = encrypt(bot_token);
      } catch (e) {
        return res.status(500).json({ error: 'Erro ao criptografar token' });
      }
    }

    const { data, error } = await supabase.from('clients').update(updates).eq('id', req.params.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    if (active !== undefined || bot_token) {
      if (active === false) {
        await botManager.stopBot(req.params.id);
      } else if (active === true || bot_token) {
        try { await botManager.startBot(req.params.id); } catch (e) {}
      }
    }

    res.json({ ...data, bot_token: '🔒' });
  });

  app.delete('/clients/:id', authMiddleware, adminOnly, async (req, res) => {
    await botManager.stopBot(req.params.id);
    await supabase.from('pedidos').update({ client_id: null }).eq('client_id', req.params.id);
    const { error } = await supabase.from('clients').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post('/clients/:id/renew', authMiddleware, adminOnly, async (req, res) => {
    const { plan } = req.body;
    const planDurations = { semanal: 7, mensal: 30, trimestral: 90 };
    const addDays = plan ? planDurations[plan] : (req.body.days || 30);

    const { data: client } = await supabase.from('clients').select('expires_at').eq('id', req.params.id).maybeSingle();
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const baseDate = client.expires_at ? new Date(client.expires_at) : new Date();
    if (baseDate < new Date()) baseDate.setTime(Date.now());

    const newExpires = new Date(baseDate.getTime() + addDays * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase.from('clients').update({
      expires_at: newExpires.toISOString(),
      active: true
    }).eq('id', req.params.id).select().maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    await botManager.startBot(req.params.id);

    res.json(data);
  });

  // --- BOTS ---
  app.post('/bots/start', authMiddleware, async (req, res) => {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId obrigatório' });

    if (!req.user.isAdmin && req.user.id !== clientId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    try {
      await botManager.startBot(clientId);
      res.json({ success: true, status: botManager.getStatus(clientId) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/bots/stop', authMiddleware, async (req, res) => {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId obrigatório' });

    if (!req.user.isAdmin && req.user.id !== clientId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    await botManager.stopBot(clientId);
    res.json({ success: true });
  });

  app.post('/bots/restart', authMiddleware, async (req, res) => {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId obrigatório' });

    if (!req.user.isAdmin && req.user.id !== clientId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    try {
      await botManager.restartBot(clientId);
      res.json({ success: true, status: botManager.getStatus(clientId) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/bots/status', authMiddleware, (req, res) => {
    const statuses = botManager.getAllStatuses();
    res.json(statuses);
  });

  app.get('/bots/status/:clientId', authMiddleware, async (req, res) => {
    const { clientId } = req.params;

    if (!req.user.isAdmin && req.user.id !== clientId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const status = botManager.getStatus(clientId);
    const tag = botManager.getBotTag(clientId);

    const { data: client } = await supabase.from('clients').select('expires_at, plan, active').eq('id', clientId).maybeSingle();

    res.json({ clientId, status, tag, ...client });
  });

  // --- LOGS ---
  app.get('/logs/:clientId', authMiddleware, async (req, res) => {
    const { clientId } = req.params;

    if (!req.user.isAdmin && req.user.id !== clientId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // --- STATS ---
  app.get('/admin/stats', authMiddleware, adminOnly, async (req, res) => {
    const { count: totalClients } = await supabase.from('clients').select('*', { count: 'exact', head: true });
    const { count: activeClients } = await supabase.from('clients').select('*', { count: 'exact', head: true }).eq('active', true);

    const botsOnline = Object.values(botManager.getAllStatuses()).filter(s => s === 'online').length;

    res.json({
      totalClients: totalClients || 0,
      activeClients: activeClients || 0,
      botsOnline,
      botsTotal: botManager.instances.size
    });
  });

  // --- HEALTH ---
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), bots: botManager.instances.size });
  });

  // --- MERCADO PAGO WEBHOOK ---
  app.post('/webhook/mercadopago', async (req, res) => {
    try {
      const { type, data: eventData } = req.body;
      if (type === 'payment' && eventData?.id) {
        const payment = await getPayment(eventData.id);
        const pedidoId = payment.external_reference;
        if (!pedidoId) return res.sendStatus(200);

        if (payment.status === 'approved') {
          const { data: pedido } = await supabase
            .from('pedidos')
            .update({ status: 'APROVADO', mp_payment_id: String(payment.id) })
            .eq('id', pedidoId)
            .select('*')
            .maybeSingle();

          if (pedido) {
            console.log(`✅ MP pagamento ${payment.id} aprovado para pedido ${pedidoId}`);

            const { data: produto } = await supabase.from('produtos').select('payment_flow').match({ id: pedido.produto_id }).maybeSingle();
            const flow = produto?.payment_flow || null;

            for (const [, instance] of botManager.instances) {
              const guild = instance.client.guilds.cache.get(pedido.guild_id);
              if (!guild) continue;
              const channel = guild.channels.cache.get(pedido.channel_id) || await guild.channels.fetch(pedido.channel_id).catch(() => null);
              if (!channel) continue;
              const buyer = await instance.client.users.fetch(pedido.user_id).catch(() => null);

              // Delivery for flows that need it
              let entregaDM = false;
              const deveEntregar = flow === null || flow === 'AUTO_DELIVERY' || flow === 'EXTERNAL_LINK' || flow === 'LICENSE_KEY' || flow === 'BOT_SAAS';
              if (deveEntregar && pedido.produto_id) {
                try {
                  const qtd = pedido.quantidade || 1;
                  let queryItem = supabase
                    .from('itens_estoque')
                    .select('*')
                    .eq('produto_id', pedido.produto_id)
                    .eq('vendido', false)
                    .limit(qtd);
                  if (pedido.plano_nome) queryItem = queryItem.eq('plano_nome', pedido.plano_nome);
                  else queryItem = queryItem.is('plano_nome', null);
                  const { data: itens } = await queryItem;
                  if (itens && itens.length > 0) {
                    const itemIds = itens.map(i => i.id);
                    await supabase.from('itens_estoque').update({ vendido: true, pedido_id: pedido.id }).in('id', itemIds);
                    if (buyer) {
                      const conteudo = itens.map(i => i.conteudo).join('\n');
                      let titulo, desc;
                      if (flow === 'EXTERNAL_LINK') { titulo = '🔗 Seu Produto Foi Entregue'; desc = `Seu acesso foi liberado.\n\n${conteudo}`; }
                      else if (flow === 'LICENSE_KEY') { titulo = '🔑 Sua Licença Foi Entregue'; desc = `Sua compra foi aprovada.\n\n\`\`\`${conteudo}\`\`\``; }
                      else { titulo = '✅ Produto(s) Entregue(s)!'; desc = `**Obrigado pela compra!**\n\nAqui ${itens.length > 1 ? 'estão seus produtos' : 'está o seu produto'}:\n\`\`\`${conteudo}\`\`\``; }
                      await buyer.send({ embeds: [new EmbedBuilder().setTitle(titulo).setDescription(desc).setColor('#00FF00')] }).catch(() => {});
                      entregaDM = true;
                    }
                  }
                } catch (e) { console.error('Erro entrega MP webhook:', e); }
              }

              if (flow === null || flow === 'BOT_SAAS') {
                const embed = new EmbedBuilder()
                  .setTitle('✅ Pagamento Aprovado (Mercado Pago)')
                  .setDescription(`Olá ${buyer || pedido.user_id}, seu pagamento foi confirmado automaticamente!\n\nAgora envie o token do seu bot para concluir a instalação.`)
                  .setColor('#00FF00');
                const row = new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId(`insert_token_${pedidoId}`).setLabel('Inserir Token').setStyle(ButtonStyle.Primary)
                );
                await channel.send({ embeds: [embed], components: [row] });
              } else if (flow === 'AUTO_DELIVERY' || flow === 'EXTERNAL_LINK' || flow === 'LICENSE_KEY') {
                if (entregaDM) {
                  const embed = new EmbedBuilder()
                    .setTitle('✅ Pagamento Aprovado')
                    .setDescription('Seu pagamento foi confirmado e seu produto foi entregue em sua mensagem privada.')
                    .setColor('#00FF00');
                  const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('📦 Ver Meu Pedido').setStyle(ButtonStyle.Link).setURL('https://discord.com/channels/@me')
                  );
                  await channel.send({ embeds: [embed], components: [row] });
                  setTimeout(() => channel.delete().catch(() => {}), 8000);
                } else {
                  await channel.send('❌ Não foi possível entregar o produto. Sua DM pode estar fechada. Contacte a staff.');
                }
              } else if (flow === 'MANUAL') {
                await channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Pagamento Aprovado').setDescription('Pagamento confirmado. A equipe será notificada para realizar a entrega manualmente.').setColor('#FFA500')] });
              } else if (flow === 'DISCORD_ROLE') {
                await channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Cargo Entregue').setDescription('Seu cargo foi entregue com sucesso.').setColor('#00FF00')] });
                setTimeout(() => channel.delete().catch(() => {}), 8000);
              } else if (flow === 'NONE') {
                await channel.send('✅ Pagamento confirmado. Nenhuma ação adicional necessária.');
                setTimeout(() => channel.delete().catch(() => {}), 8000);
              }
              break;
            }
          }
        } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
          await supabase.from('pedidos').update({ status: 'RECUSADO' }).eq('id', pedidoId);
        }
      }
      res.sendStatus(200);
    } catch (e) {
      console.error('❌ MP webhook error:', e.message);
      res.sendStatus(200);
    }
  });

  // --- OAUTH CALLBACK ---
  app.get('/oauth/callback', async (req, res) => {
    const { guild_id, state } = req.query;
    const PUBLIC_URL = process.env.PUBLIC_URL || '';

    if (!guild_id) {
      return res.send(`
        <html><body style="font-family:sans-serif;background:#0f0c29;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center"><h2>❌ guild_id não encontrado</h2><p>Certifique-se de autorizar o bot em um servidor Discord.</p></div>
        </body></html>
      `);
    }

    if (state) {
      await supabase.from('clients').update({ server_id: guild_id, active: true }).eq('id', state);
      try {
        await botManager.startBot(state);
        const { data: client } = await supabase.from('clients').select('username').eq('id', state).maybeSingle();
        console.log(`✅ Bot ${client?.username || state} iniciado via OAuth no servidor ${guild_id}`);
      } catch (e) {
        console.error(`❌ Erro ao iniciar bot via OAuth: ${e.message}`);
      }
    }

    res.send(`
      <html><body style="font-family:sans-serif;background:#0f0c29;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">
      <div style="text-align:center">
        <h2>✅ Bot adicionado com sucesso!</h2>
        <p>Servidor ID: ${guild_id}</p>
        <p>O bot está sendo iniciado. Volte ao Discord para ver seu bot funcionando.</p>
        <p style="margin-top:20px;font-size:12px;color:rgba(255,255,255,0.4)">MQS Systems</p>
      </div>
      </body></html>
    `);
  });

  // --- FALLBACK: SPA routing ---
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  const host = '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`🌐 Servidor web rodando em ${host}:${port}`);
  });

  return app;
}
