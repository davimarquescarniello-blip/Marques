import 'dotenv/config';
import { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  ActivityType
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { generatePix } from './utils/pix.js';
import { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } from '@discordjs/voice';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const defaultSupabase = createClient(supabaseUrl, supabaseKey);

export async function createBot(token, { supabase: _supabase, guildId: _guildId, botManager, clientId } = {}) {
  const supabase = _supabase || defaultSupabase;
  const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;

  const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
    sweepers: {
      messages: { interval: 1800, lifetime: 900 }
    }
  });

const commands = [
  new SlashCommandBuilder()
    .setName('setup-vendas')
    .setDescription('⚙️ Cria um produto e envia o painel exclusivo dele neste canal.')
    .addStringOption(option => option.setName('nome').setDescription('Nome do produto').setRequired(true))
    .addStringOption(option => option.setName('preco').setDescription('Preço do produto (Ex: 29.90)').setRequired(true))
    .addStringOption(option => option.setName('descricao').setDescription('Vantagens/Descrição do produto').setRequired(true))
    .addStringOption(option => option.setName('imagem').setDescription('URL do Banner grande (opcional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('🎫 Envia o painel de atendimento/ticket fixo neste canal.'),


  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('📊 Exibe o resumo analítico de vendas e faturamento.'),

  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('⚙️ Painel de configuração exclusiva do Bot.'),

  new SlashCommandBuilder()
    .setName('editar-setup-vendas')
    .setDescription('⚙️ Edita os produtos do canal atual.'),

  new SlashCommandBuilder()
    .setName('editar-setup-ticket')
    .setDescription('⚙️ Edita o painel de ticket deste canal.'),

  new SlashCommandBuilder()
    .setName('add-estoque')
    .setDescription('📦 Adiciona itens ao estoque de um produto deste canal.'),

  new SlashCommandBuilder()
    .setName('entrar-call')
    .setDescription('🔊 Faz o bot entrar na sua call e ficar 24h.'),

  new SlashCommandBuilder()
    .setName('sair-call')
    .setDescription('🔇 Faz o bot sair da call.'),

  // === SAAS ADMIN COMMANDS ===
  new SlashCommandBuilder()
    .setName('saas-add-bot')
    .setDescription('[ADMIN] Adicionar um novo bot ao sistema')
    .addStringOption(opt => opt.setName('token').setDescription('Token do bot Discord').setRequired(true))
    .addStringOption(opt => opt.setName('username').setDescription('Username para login no painel').setRequired(false))
    .addStringOption(opt => opt.setName('plan').setDescription('Plano (semanal/mensal/trimestral)')
      .addChoices(
        { name: 'Semanal (7 dias)', value: 'semanal' },
        { name: 'Mensal (30 dias)', value: 'mensal' },
        { name: 'Trimestral (90 dias)', value: 'trimestral' }
      ).setRequired(false)),

  new SlashCommandBuilder()
    .setName('saas-list')
    .setDescription('[ADMIN] Listar todos os bots do sistema'),

  new SlashCommandBuilder()
    .setName('saas-stop')
    .setDescription('[ADMIN] Parar um bot')
    .addStringOption(opt => opt.setName('id').setDescription('ID do cliente').setRequired(true)),

  new SlashCommandBuilder()
    .setName('saas-start')
    .setDescription('[ADMIN] Iniciar um bot')
    .addStringOption(opt => opt.setName('id').setDescription('ID do cliente').setRequired(true)),

  new SlashCommandBuilder()
    .setName('saas-restart')
    .setDescription('[ADMIN] Reiniciar um bot')
    .addStringOption(opt => opt.setName('id').setDescription('ID do cliente').setRequired(true)),
].map(command => command.toJSON());

client.on('guildCreate', async (guild) => {
  if (clientId) {
    const { data: existing } = await supabase.from('clients').select('server_id').eq('id', clientId).maybeSingle();
    if (existing && !existing.server_id) {
      await supabase.from('clients').update({ server_id: guild.id }).eq('id', clientId);
      console.log(`🆕 Bot ${clientId.slice(0,8)}... detectado no servidor ${guild.name} (${guild.id})`);
    }
  }
});

client.once('clientReady', async () => {
  await client.user.fetch();
  client.user.setPresence({ activities: [{ name: 'Mqs Systems', type: ActivityType.Playing }] });
  console.log(`Logado com sucesso como: ${client.user.tag} avatar=`, client.user.displayAvatarURL({ dynamic: true }));

  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Comandos sincronizados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }

  try {
    const { data: calls } = await supabase.from('calls').select('*').eq('ativo', true);
    if (calls) {
      for (const call of calls) {
        const guild = client.guilds.cache.get(call.guild_id);
        if (!guild) continue;
        const channel = guild.channels.cache.get(call.channel_id);
        if (!channel || channel.type !== ChannelType.GuildVoice) continue;
        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
        });
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            connection.destroy();
            await supabase.from('calls').update({ ativo: false }).match({ guild_id: call.guild_id });
          }
        });
        connection.on('error', console.error);
        console.log(`🔊 Reconectado à call: ${channel.name}`);
      }
    }
  } catch (e) {
    console.error('❌ Erro ao reconectar calls:', e);
  }

  try {
    const { data: configs } = await supabase.from('configuracoes').select('guild_id, bot_name');
    if (configs) {
      for (const cfg of configs) {
        if (!cfg.bot_name) continue;
        const g = client.guilds.cache.get(cfg.guild_id);
        if (!g) continue;
        await g.members.me.setNickname(cfg.bot_name).catch(() => {});
      }
    }
  } catch (e) {
    console.error('❌ Erro ao restaurar apelidos:', e);
  }
});

async function hasStaffPermission(interaction) {
  if (interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const { data: cfg } = await supabase.from('configuracoes').select('staff_role_id').match({ guild_id: interaction.guildId }).maybeSingle();
  if (cfg?.staff_role_id && interaction.member?.roles.cache.has(cfg.staff_role_id)) return true;
  return false;
}

async function renderSingleProductEmbed(interaction, prod) {
  const { data: configData } = await supabase.from('configuracoes').select('*').match({ guild_id: interaction.guildId });
  const config = configData && configData.length > 0 ? configData[0] : null;

  let estoqueTotal = 0;
  try {
    const { count } = await supabase
      .from('itens_estoque')
      .select('*', { count: 'exact', head: true })
      .eq('produto_id', prod.id)
      .eq('vendido', false);
    if (count !== null) estoqueTotal = count;
  } catch (e) {}

  const precoTexto = prod.opcoes?.length > 0 
    ? `A partir de R$ ${parseFloat(prod.opcoes.reduce((min, o) => Math.min(min, parseFloat(o.preco)), Infinity)).toFixed(2)}`
    : `R$ ${parseFloat(prod.preco).toFixed(2)}`;

  const descriptionText = 
    `${prod.descricao || 'Sem descrição disponível.'}\n\n` +
    `💰 **Preço:** ${precoTexto}\n` +
    `📦 **Estoque:** ${estoqueTotal} unidades\n\n` +
    `➡ Selecione abaixo a opção que melhor atende à sua necessidade para continuar o atendimento.`;

  const embed = new EmbedBuilder()
    .setTitle(prod.nome)
    .setDescription(descriptionText)
    .setColor('#010101'); 

  const avatarIcon = (config?.bot_avatar && /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(config.bot_avatar)) ? config.bot_avatar : client.user.displayAvatarURL({ dynamic: true });
  embed.setAuthor({ 
    name: config?.bot_name || prod.nome, 
    iconURL: avatarIcon 
  });

  const bannerUrl = prod.imagem_url || config?.imagem_url;
  if (bannerUrl) embed.setImage(bannerUrl);

  return embed;
}

async function getSingleProductComponents(prod, allowedToEdit = false) {
  const components = [];
  if (prod.opcoes && Array.isArray(prod.opcoes) && prod.opcoes.length > 0) {
    const stockPorPlano = {};
    for (const opt of prod.opcoes) {
      try {
        const { count } = await supabase
          .from('itens_estoque')
          .select('*', { count: 'exact', head: true })
          .eq('produto_id', prod.id)
          .eq('vendido', false)
          .eq('plano_nome', opt.nome);
        stockPorPlano[opt.nome] = count || 0;
      } catch { stockPorPlano[opt.nome] = 0; }
    }
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_plan_${prod.id}`)
      .setPlaceholder('Clique aqui para ver as opções...')
      .addOptions(
        prod.opcoes.map((opt, i) => ({
          label: opt.nome,
          description: `R$ ${parseFloat(opt.preco).toFixed(2)} | Estoque: ${stockPorPlano[opt.nome] || 0}`,
          value: String(i)
        }))
      );
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const hasPlans = prod.opcoes && Array.isArray(prod.opcoes) && prod.opcoes.length > 0;
  if (!hasPlans) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`buy_main_${prod.id}`).setLabel('Comprar').setStyle(ButtonStyle.Success).setEmoji('🛒')
      )
    );
  }
  return components;
}

async function refreshChannelPanel(interaction, prodId) {
  try {
    const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
    if (!prod || !prod.canal_id) return;
    const channel = await interaction.guild.channels.fetch(prod.canal_id).catch(() => null);
    if (!channel) return;
    const { data: cfg } = await supabase.from('configuracoes').select('bot_name').match({ guild_id: interaction.guildId }).maybeSingle();
    const authorName = cfg?.bot_name || prod.nome;
    const messages = await channel.messages.fetch({ limit: 50 });
    const targetMessage = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && 
      (m.embeds[0].author?.name === prod.nome || m.embeds[0].author?.name === authorName));
    if (targetMessage) {
      const embed = await renderSingleProductEmbed(interaction, prod);
      const cmps = await getSingleProductComponents(prod, false);
      await targetMessage.edit({ embeds: [embed], components: cmps }).catch(() => {});
    }
    } catch (err) { console.error(`Erro refreshChannelPanel prod=${prodId}:`, err?.message || err); }
}

client.on('interactionCreate', async interaction => {
  try {
    const isStaff = await hasStaffPermission(interaction);
    const guild = interaction.guild;

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_identity_submit') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const novoNomeBot = interaction.fields.getTextInputValue('modal_bot_name');
        const novoAvatarBot = interaction.fields.getTextInputValue('modal_bot_avatar');
        const { data: existente } = await supabase.from('configuracoes').select('bot_name, bot_avatar').match({ guild_id: interaction.guildId }).maybeSingle();
        const urlValida = novoAvatarBot && /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(novoAvatarBot);
        if (novoAvatarBot && !urlValida) {
          return interaction.editReply('❌ URL inválida. Use uma URL que termine em **.png**, **.jpg**, **.jpeg**, **.gif** ou **.webp** (ex: Imgur, PostImages).');
        }
        const avatarSalvo = urlValida ? novoAvatarBot : (existente?.bot_avatar || null);
        await supabase.from('configuracoes').upsert({
          guild_id: interaction.guildId,
          bot_name: novoNomeBot || existente?.bot_name || null,
          bot_avatar: avatarSalvo
        });

        if (novoNomeBot) {
          await guild.members.me.setNickname(novoNomeBot).catch(e => console.error('Erro setNickname:', e));
        }

        try {
          const msgs = await interaction.channel.messages.fetch({ limit: 20 }).catch(() => null);
          if (msgs) {
            const pm = msgs.find(m => m.author.id === client.user.id && m.components.length > 0);
            if (pm) {
              const bb = pm.components.flatMap(r => r.components).find(c => c.customId?.startsWith('buy_main_'));
              if (bb) {
                const pid = bb.customId.split('_')[2];
                const { data: prod } = await supabase.from('produtos').select('*').match({ id: pid }).maybeSingle();
                if (prod && prod.canal_id === interaction.channel.id) {
                  const embed = await renderSingleProductEmbed(interaction, prod);
                  const cmps = await getSingleProductComponents(prod, false);
                  await pm.edit({ embeds: [embed], components: cmps });
                }
              }
            }
          }
        } catch (e) { console.error('Erro refresh painel do canal atual:', e); }

        return interaction.editReply('✅ **Identidade visual atualizada apenas neste servidor!**');
      }

      if (interaction.customId === 'modal_shop_config_submit') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');

        const guildId = interaction.guildId;
        const novaChave = interaction.fields.getTextInputValue('modal_pix');
        const novoNomePix = interaction.fields.getTextInputValue('modal_pix_name');
        const novaCidadePix = interaction.fields.getTextInputValue('modal_pix_city');
        const cargoCliente = interaction.fields.getTextInputValue('modal_role_client');
        const cargoStaff = interaction.fields.getTextInputValue('modal_role_staff');

        const { data: existente } = await supabase.from('configuracoes').select('*').match({ guild_id: guildId });
        const configAtual = existente && existente.length > 0 ? existente[0] : null;

        await supabase.from('configuracoes').upsert({
          guild_id: guildId,
          pix_key: novaChave || configAtual?.pix_key || process.env.PIX_KEY || 'Não Configurada',
          pix_name: novoNomePix || configAtual?.pix_name || process.env.PIX_NAME || 'MQS BOT',
          pix_city: novaCidadePix || configAtual?.pix_city || process.env.PIX_CITY || 'SAO PAULO',
          role_id: cargoCliente || configAtual?.role_id || null,
          staff_role_id: cargoStaff || configAtual?.staff_role_id || null,
          logs_vendas_id: configAtual?.logs_vendas_id || null,
          loja_channel_id: configAtual?.loja_channel_id || null,
          feedback_channel_id: configAtual?.feedback_channel_id || null,
          imagem_url: configAtual?.imagem_url || null,
          ticket_role_id: configAtual?.ticket_role_id || null,
          bot_name: configAtual?.bot_name || null,
          bot_avatar: configAtual?.bot_avatar || null
        });

        return interaction.editReply('✅ **Configurações operacionais salvas!**');
      }

      if (interaction.customId === 'modal_shop_channels_submit') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');

        const guildId = interaction.guildId;
        const canalLogsVendas = interaction.fields.getTextInputValue('modal_logs_vendas');
        const canalLojaVendas = interaction.fields.getTextInputValue('modal_loja_vendas');
        const canalFeedbacks = interaction.fields.getTextInputValue('modal_feedbacks');

        const { data: existente } = await supabase.from('configuracoes').select('*').match({ guild_id: guildId });
        const configAtual = existente && existente.length > 0 ? existente[0] : null;

        await supabase.from('configuracoes').upsert({
          guild_id: guildId,
          pix_key: configAtual?.pix_key || process.env.PIX_KEY || 'Não Configurada',
          pix_name: configAtual?.pix_name || null,
          pix_city: configAtual?.pix_city || null,
          role_id: configAtual?.role_id || null,
          staff_role_id: configAtual?.staff_role_id || null,
          logs_vendas_id: canalLogsVendas || configAtual?.logs_vendas_id || null,
          loja_channel_id: canalLojaVendas || configAtual?.loja_channel_id || null,
          feedback_channel_id: canalFeedbacks || configAtual?.feedback_channel_id || null,
          imagem_url: configAtual?.imagem_url || null,
          ticket_role_id: configAtual?.ticket_role_id || null,
          bot_name: configAtual?.bot_name || null,
          bot_avatar: configAtual?.bot_avatar || null
        });

        return interaction.editReply('✅ **Canais salvos com sucesso!**');
      }

      // SUBMIT DE CONFIGURAÇÃO DE TICKET (SALVA DETALHADAMENTE POR CANAL)
      if (interaction.customId === 'modal_edit_ticket_config') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        
        const novoTitulo = interaction.fields.getTextInputValue('ticket_title_input');
        const novaDescricao = interaction.fields.getTextInputValue('ticket_desc_input');
        const novoBanner = interaction.fields.getTextInputValue('ticket_banner_input');
        const cargoId = interaction.fields.getTextInputValue('ticket_role_input');

        await supabase.from('configuracoes_tickets').upsert({ 
          guild_id: interaction.guildId,
          channel_id: interaction.channelId,
          ticket_role_id: cargoId || null,
          ticket_title: novoTitulo || null,
          ticket_desc: novaDescricao || null,
          ticket_banner: novoBanner || null
        });

        try {
          const messages = await interaction.channel.messages.fetch({ limit: 20 });
          const painelMensagem = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components.some(c => c.customId === 'open_ticket'));
          
          if (painelMensagem) {
            const embedAtualizado = new EmbedBuilder()
              .setTitle(novoTitulo || `Central de Atendimento | ${client.user.username}`)
              .setDescription(novaDescricao || `> Após solicitar atendimento, aguarde a resposta de um membro da equipe.\n\n> Os atendimentos são realizados de forma privada.\n\nClique no botão abaixo para abrir um ticket:`)
              .setColor('#2F3136');
            
            if (novoBanner && novoBanner.startsWith('http')) {
              embedAtualizado.setImage(novoBanner);
            }
            
            await painelMensagem.edit({ embeds: [embedAtualizado] });
          }
        } catch (e) {}

        return interaction.editReply('✅ **Configurações deste painel de suporte atualizadas com sucesso!**');
      }

      if (interaction.customId.startsWith('modal_edit_desc_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const novaDesc = interaction.fields.getTextInputValue('new_desc');
        const { error } = await supabase.from('produtos').update({ descricao: novaDesc }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro ao salvar: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply('✅ Descrição do produto alterada!');
      }

      if (interaction.customId.startsWith('modal_edit_banner_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const bannerUrl = interaction.fields.getTextInputValue('banner_url');
        if (!bannerUrl.startsWith('http')) return interaction.editReply('❌ URL inválida. Insira um link começando com http.');
        const { error } = await supabase.from('produtos').update({ imagem_url: bannerUrl }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro ao salvar: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply('✅ Banner do produto atualizado!');
      }

      if (interaction.customId.startsWith('modal_add_plan_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const pNome = interaction.fields.getTextInputValue('plan_nome');
        const pPreco = parseFloat(interaction.fields.getTextInputValue('plan_preco') || 0);
        const pEstoque = parseInt(interaction.fields.getTextInputValue('plan_estoque') || 0);

        const { data } = await supabase.from('produtos').select('opcoes').match({ id: prodId }).maybeSingle();
        const listaAtual = data?.opcoes || [];
        listaAtual.push({ nome: pNome, preco: pPreco, estoque: pEstoque });

        const { error } = await supabase.from('produtos').update({ opcoes: listaAtual }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro ao salvar: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply('✅ Novo plano adicionado!');
      }

      if (interaction.customId.startsWith('modal_qtd_plan_')) {
        if (!isStaff) await interaction.deferReply();
        else await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const parts = interaction.customId.split('_');
        const prodId = parts[3];
        const opcaoIndex = parseInt(parts[4]);
        const qtd = parseInt(interaction.fields.getTextInputValue('qtd_input'));

        if (isNaN(qtd) || qtd < 1) return interaction.editReply('❌ Quantidade inválida.');

        const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
        if (!prod || !prod.opcoes?.[opcaoIndex]) return interaction.editReply('Opção inválida.');

        const planoEscolhido = prod.opcoes[opcaoIndex];
        const { count: stockCount } = await supabase
          .from('itens_estoque')
          .select('*', { count: 'exact', head: true })
          .eq('produto_id', prod.id)
          .eq('vendido', false)
          .eq('plano_nome', planoEscolhido.nome);

        if (!stockCount || stockCount < qtd) return interaction.editReply(`❌ Estoque insuficiente. Disponível: ${stockCount || 0}, solicitado: ${qtd}.`);

        const valorTotal = parseFloat(planoEscolhido.preco) * qtd;

        const canal = await guild.channels.create({
          name: `🛒-pix-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        let insertedId = null;

        let { data: insData, error: insertError } = await supabase.from('pedidos').insert([{ 
          user_id: String(interaction.user.id), 
          channel_id: String(canal.id), 
          produto_id: prod.id, 
          valor: valorTotal, 
          quantidade: qtd,
          status: 'PENDENTE', 
          plano_nome: String(planoEscolhido.nome), 
          guild_id: interaction.guildId
        }]).select('id').maybeSingle();

        if (insData) insertedId = insData.id;

        if (insertError) {
          const fallback = await supabase.from('pedidos').insert([{ 
            user_id: String(interaction.user.id), 
            channel_id: String(canal.id), 
            valor: valorTotal, 
            quantidade: qtd,
            status: 'PENDENTE', 
            plano_nome: String(`${prod.nome} - ${planoEscolhido.nome}`), 
            guild_id: interaction.guildId
          }]).select('id').maybeSingle();
          
          if (fallback.data) insertedId = fallback.data.id;
        }

        const { data: cfg } = await supabase.from('configuracoes').select('*').match({ guild_id: interaction.guildId }).maybeSingle();

        const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        let pixString, qrCodeUrl, embedDescription, mpPaymentId;

        if (mpToken && insertedId) {
          try {
            const { createPixPayment } = await import('./mercadopago.js');
            const mpPayment = await createPixPayment({
              amount: valorTotal,
              description: `${prod.nome} - ${planoEscolhido.nome}`,
              externalReference: String(insertedId),
              email: `${interaction.user.id}@discord.gg`
            });
            pixString = mpPayment.point_of_interaction?.transaction_data?.qr_code || '';
            qrCodeUrl = mpPayment.point_of_interaction?.transaction_data?.qr_code_base64
              ? `data:image/png;base64,${mpPayment.point_of_interaction.transaction_data.qr_code_base64}`
              : `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixString)}`;
            mpPaymentId = mpPayment.id;
            await supabase.from('pedidos').update({ mp_payment_id: String(mpPayment.id) }).eq('id', insertedId);
          } catch (e) {
            console.error('Erro MP PIX, fallback para PIX estático:', e.message);
          }
        }

        if (!pixString) {
          pixString = generatePix(valorTotal, interaction.user.username, { chave: cfg?.pix_key, nome: cfg?.pix_name, cidade: cfg?.pix_city });
          qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixString)}`;
        }

        embedDescription = mpPaymentId
          ? `**Produto:** ${prod.nome}\n**Plano:** ${planoEscolhido.nome}\n**Quantidade:** ${qtd}\n**Valor unitário:** R$ ${parseFloat(planoEscolhido.preco).toFixed(2)}\n**Valor total:** R$ ${valorTotal.toFixed(2)}\n\n**PIX Mercado Pago** (confirmação automática)\n\`\`\`${pixString}\`\`\``
          : `**Produto:** ${prod.nome}\n**Plano:** ${planoEscolhido.nome}\n**Quantidade:** ${qtd}\n**Valor unitário:** R$ ${parseFloat(planoEscolhido.preco).toFixed(2)}\n**Valor total:** R$ ${valorTotal.toFixed(2)}\n\n**Código PIX Copia e Cola:**\n\`\`\`${pixString}\`\`\``;

        await interaction.editReply(`🔒 Canal de pagamento gerado em <#${canal.id}>`);

        const embedPix = new EmbedBuilder()
          .setTitle(`💰 Pagamento - ${prod.nome}`)
          .setDescription(embedDescription)
          .setColor('#5865F2')
          .setImage(qrCodeUrl);
        
        const rowControleStaff = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${insertedId || 'fallback'}`).setLabel('✅ Aprovar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${insertedId || 'fallback'}`).setLabel('❌ Reprovar').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`cancel_channel_${insertedId || 'fallback'}`).setLabel('Cancelar Venda').setStyle(ButtonStyle.Secondary)
        );
        const rowCupom = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`apply_coupon_${insertedId || 'fallback'}`).setLabel('🎟️ Cupom de Desconto').setStyle(ButtonStyle.Primary)
        );

        await canal.send({ content: `${interaction.user}`, embeds: [embedPix], components: [rowControleStaff, rowCupom] });
      }

      if (interaction.customId.startsWith('modal_edit_plan_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const parts = interaction.customId.split('_');
        const prodId = parts[3];
        const index = parseInt(parts[4]);
        const novoNome = interaction.fields.getTextInputValue('edit_plan_nome');
        const novoPreco = parseFloat(interaction.fields.getTextInputValue('edit_plan_preco') || 0);

        const { data: prod } = await supabase.from('produtos').select('opcoes').match({ id: prodId }).maybeSingle();
        if (!prod?.opcoes?.[index]) return interaction.editReply('❌ Plano não encontrado.');
        prod.opcoes[index] = { ...prod.opcoes[index], nome: novoNome, preco: novoPreco };

        const { error } = await supabase.from('produtos').update({ opcoes: prod.opcoes }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro ao salvar: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply('✅ Plano editado com sucesso!');
      }

      if (interaction.customId.startsWith('modal_add_itens_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const conteudo = interaction.fields.getTextInputValue('itens_conteudo');
        const planoNome = interaction.fields.getTextInputValue('itens_plano')?.trim() || null;
        const linhas = conteudo.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (linhas.length === 0) return interaction.editReply('❌ Nenhum item válido encontrado.');

        const { data: prod } = await supabase.from('produtos').select('id').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.editReply('❌ Produto não encontrado.');

        const itensParaInserir = linhas.map(linha => ({
          produto_id: prodId,
          conteudo: linha,
          vendido: false,
          plano_nome: planoNome
        }));

        const { error } = await supabase.from('itens_estoque').insert(itensParaInserir);
        if (error) return interaction.editReply(`❌ Erro ao salvar itens: ${error.message}`);

        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply(`✅ **${linhas.length} itens** adicionados ao estoque!`);
      }

      if (interaction.customId.startsWith('modal_set_stock_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const qtd = parseInt(interaction.fields.getTextInputValue('stock_qtd'));
        if (isNaN(qtd) || qtd < 0) return interaction.editReply('❌ Quantidade inválida.');

        const { error: delError } = await supabase
          .from('itens_estoque')
          .delete()
          .eq('produto_id', prodId)
          .eq('vendido', false);
        if (delError) return interaction.editReply(`❌ Erro ao limpar estoque: ${delError.message}`);

        if (qtd > 0) {
          const placeholders = Array.from({ length: qtd }, (_, i) => ({
            produto_id: prodId,
            conteudo: `Item #${i + 1} gerado automaticamente`,
            vendido: false
          }));
          const { error: insError } = await supabase.from('itens_estoque').insert(placeholders);
          if (insError) return interaction.editReply(`❌ Erro ao gerar itens: ${insError.message}`);
        }

        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply(`✅ Estoque definido para **${qtd} itens**!`);
      }

      if (interaction.customId.startsWith('modal_edit_price_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const novoPreco = parseFloat(interaction.fields.getTextInputValue('new_price').replace(',', '.'));
        if (isNaN(novoPreco) || novoPreco <= 0) return interaction.editReply('❌ Preço inválido.');

        const { error } = await supabase.from('produtos').update({ preco: novoPreco }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro ao salvar: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply(`✅ Preço atualizado para **R$ ${novoPreco.toFixed(2)}**!`);
      }

      if (interaction.customId.startsWith('modal_edit_name_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const prodId = interaction.customId.split('_')[3];
        const novoNome = interaction.fields.getTextInputValue('new_name').trim();
        if (!novoNome) return interaction.editReply('❌ Nome inválido.');

        const { error } = await supabase.from('produtos').update({ nome: novoNome }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro ao salvar: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return interaction.editReply(`✅ Nome atualizado para **${novoNome}**!`);
      }

      if (interaction.customId === 'modal_cupom_criar') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const codigo = interaction.fields.getTextInputValue('cupom_codigo').toUpperCase().trim();
        const tipo = interaction.fields.getTextInputValue('cupom_tipo').trim().toLowerCase();
        const valor = parseFloat(interaction.fields.getTextInputValue('cupom_valor').replace(',', '.'));
        const produtoNome = interaction.fields.getTextInputValue('cupom_produto').trim();
        const usosMax = interaction.fields.getTextInputValue('cupom_usos').trim();

        if (!codigo) return interaction.editReply('❌ Código inválido.');
        if (tipo !== 'percentual' && tipo !== 'fixo') return interaction.editReply('❌ Tipo deve ser "percentual" ou "fixo".');
        if (isNaN(valor) || valor <= 0) return interaction.editReply('❌ Valor inválido.');
        if (tipo === 'percentual' && valor > 100) return interaction.editReply('❌ Percentual não pode ser maior que 100.');

        let produtoId = null;
        if (produtoNome && produtoNome.toLowerCase() !== 'qualquer') {
          const { data: prod } = await supabase.from('produtos').select('id').match({ nome: produtoNome, guild_id: interaction.guildId }).maybeSingle();
          if (!prod) return interaction.editReply(`❌ Produto "${produtoNome}" não encontrado.`);
          produtoId = prod.id;
        }

        const usosMaximos = usosMax ? parseInt(usosMax) : null;
        if (usosMax && (isNaN(usosMaximos) || usosMaximos < 1)) return interaction.editReply('❌ Máximo de usos inválido.');

        const { error } = await supabase.from('cupons').insert({
          codigo, guild_id: interaction.guildId, desconto_tipo: tipo, desconto_valor: valor,
          produto_id: produtoId, usos_maximos: usosMaximos, usos_atuais: 0, ativo: true
        });
        if (error) return interaction.editReply(`❌ Erro ao criar cupom: ${error.message}`);
        return interaction.editReply(`✅ Cupom **${codigo}** criado com sucesso!`);
      }

      if (interaction.customId.startsWith('modal_apply_coupon_')) {
        const pedidoId = interaction.customId.split('_')[3];
        const codigo = interaction.fields.getTextInputValue('coupon_code').toUpperCase().trim();
        if (!codigo) return interaction.reply({ content: '❌ Código inválido.', flags: [MessageFlags.Ephemeral] });

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const { data: pedido } = await supabase.from('pedidos').select('*').match({ id: pedidoId }).maybeSingle();
        if (!pedido || pedido.status !== 'PENDENTE') return interaction.editReply('❌ Pedido não encontrado ou já processado.');

        const { data: cupom } = await supabase.from('cupons').select('*').match({ codigo, guild_id: interaction.guildId }).maybeSingle();
        if (!cupom) return interaction.editReply('❌ Cupom não encontrado.');
        if (!cupom.ativo) return interaction.editReply('❌ Este cupom está desativado.');
        if (cupom.usos_maximos && cupom.usos_atuais >= cupom.usos_maximos) return interaction.editReply('❌ Este cupom já atingiu o limite de usos.');
        if (cupom.produto_id && cupom.produto_id !== pedido.produto_id) return interaction.editReply('❌ Este cupom não é válido para este produto.');

        let novoValor = parseFloat(pedido.valor);
        if (cupom.desconto_tipo === 'percentual') {
          novoValor = novoValor * (1 - cupom.desconto_valor / 100);
        } else {
          novoValor = Math.max(0, novoValor - cupom.desconto_valor);
        }

        const descontoTexto = cupom.desconto_tipo === 'percentual' ? `${cupom.desconto_valor}%` : `R$ ${parseFloat(cupom.desconto_valor).toFixed(2)}`;

        await supabase.from('pedidos').update({ valor: novoValor, cupom_codigo: codigo }).match({ id: pedidoId });

        try {
          const canal = await guild.channels.fetch(pedido.channel_id);
          if (canal) {
            const msgs = await canal.messages.fetch({ limit: 10 });
            const pixMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
            if (pixMsg) {
              const embedEdit = EmbedBuilder.from(pixMsg.embeds[0])
                .setDescription(`${pixMsg.embeds[0].description}\n\n**🎟️ Cupom aplicado:** \`${codigo}\` (${descontoTexto})\n**💰 Novo valor:** R$ ${novoValor.toFixed(2)}`);
              await pixMsg.edit({ embeds: [embedEdit] });
            }
          }
        } catch (e) {}

        return interaction.editReply(`✅ Cupom **${codigo}** aplicado! Novo valor: **R$ ${novoValor.toFixed(2)}**`);
      }

      if (interaction.customId.startsWith('modal_delete_confirm_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!isStaff) return interaction.editReply('❌ Sem permissão.');
        const confirm = interaction.fields.getTextInputValue('delete_confirm');
        if (confirm !== 'CONFIRMAR') return interaction.editReply('❌ Confirmação incorreta. Digite CONFIRMAR.');

        const prodId = interaction.customId.split('_')[3];
        const { data: prod } = await supabase.from('produtos').select('nome, canal_id').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.editReply('❌ Produto não encontrado.');

        await supabase.from('produtos').update({ active: false }).match({ id: prodId });
        await supabase.from('itens_estoque').delete().eq('produto_id', prodId).eq('vendido', false);

        try {
          const channel = await guild.channels.fetch(prod.canal_id).catch(() => null);
          if (channel) {
            const msgs = await channel.messages.fetch({ limit: 50 });
            const targetMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === prod.nome);
            if (targetMsg) await targetMsg.delete().catch(() => {});
          }
        } catch (e) {}

        return interaction.editReply(`🗑️ Produto **${prod.nome}** excluído com sucesso!`);
      }

      if (interaction.customId.startsWith('modal_token_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const pedidoId = interaction.customId.split('_')[2];
        const botToken = interaction.fields.getTextInputValue('bot_token_input').trim();

        if (!botToken) return interaction.editReply('❌ Token não pode estar vazio.');

        let botUser;
        try {
          const { REST } = await import('discord.js');
          const rest = new REST({ version: '10' }).setToken(botToken);
          botUser = await rest.get('/users/@me');
        } catch (e) {
          return interaction.editReply('❌ Token inválido. Verifique se o token está correto e tente novamente.');
        }

        const { data: pedido } = await supabase.from('pedidos').select('plano_nome').eq('id', pedidoId).maybeSingle();
        const planName = (pedido?.plano_nome || '').toLowerCase();
        const plan = planName.includes('trimestral') ? 'trimestral' : planName.includes('mensal') ? 'mensal' : 'semanal';
        const planDurations = { semanal: 7, mensal: 30, trimestral: 90 };
        const days = planDurations[plan] || 7;

        const { encrypt } = await import('./crypto.js');
        const encryptedToken = encrypt(botToken);

        const { data: clientData, error: clientError } = await supabase.from('clients').insert({
          bot_token: encryptedToken,
          active: false,
          plan,
          username: botUser.username,
          discord_user_id: interaction.user.id,
          expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        }).select().maybeSingle();

        if (clientError) return interaction.editReply(`❌ Erro ao salvar: ${clientError.message}`);

        await supabase.from('pedidos').update({ client_id: clientData.id }).eq('id', pedidoId);

        const embed = new EmbedBuilder()
          .setTitle('✅ Token Válido')
          .setDescription(`Bot **${botUser.username}** registrado com sucesso!\n\nAgora clique abaixo para adicioná-lo a um servidor.`)
          .setColor('#00FF00');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`add_bot_${clientData.id}`)
            .setLabel('Adicionar Bot')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕')
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('select_plan_')) {
        const prodId = interaction.customId.split('_')[2];
        const opcaoIndex = parseInt(interaction.values[0]);

        const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
        if (!prod || !prod.opcoes?.[opcaoIndex]) return interaction.reply({ content: '❌ Opção inválida.', flags: [MessageFlags.Ephemeral] });

        const planoEscolhido = prod.opcoes[opcaoIndex];

        const { count: stockCount } = await supabase
          .from('itens_estoque')
          .select('*', { count: 'exact', head: true })
          .eq('produto_id', prod.id)
          .eq('vendido', false)
          .eq('plano_nome', planoEscolhido.nome);
        if (!stockCount || stockCount === 0) return interaction.reply({ content: `❌ O plano **${planoEscolhido.nome}** está sem estoque no momento.`, flags: [MessageFlags.Ephemeral] });

        const qtdModal = new ModalBuilder().setCustomId(`modal_qtd_plan_${prodId}_${opcaoIndex}`).setTitle(`Quantas unidades? - ${planoEscolhido.nome}`);
        qtdModal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('qtd_input')
              .setLabel(`Estoque: ${stockCount} | Digite a quantidade`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ex: 1')
              .setValue('1')
              .setRequired(true)
          )
        );
        return await interaction.showModal(qtdModal);
      }

      if (interaction.customId === 'select_prod_editar') {
        if (!isStaff) return interaction.editReply({ content: '❌ Sem permissão.', components: [] });
        const prodId = interaction.values[0];
        const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.editReply({ content: '❌ Produto não encontrado.', components: [] });

        const embedMenuEdit = new EmbedBuilder().setTitle(`⚙️ Editando: ${prod.nome}`).setColor('#0099FF');
        const rowEdit = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_editdesc_${prod.id}`).setLabel('Editar Descrição').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_addplan_${prod.id}`).setLabel('Adicionar Plano').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`action_editbanner_${prod.id}`).setLabel('Alterar Banner').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId(`action_clearplans_${prod.id}`).setLabel('Limpar Planos').setStyle(ButtonStyle.Danger)
        );
        const rowStock = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_additens_${prod.id}`).setLabel('Adicionar Itens').setStyle(ButtonStyle.Secondary).setEmoji('📦')
        );
        return await interaction.editReply({ embeds: [embedMenuEdit], components: [rowEdit, rowStock] });
      }

      if (interaction.customId === 'select_panel_stock') {
        if (!isStaff) return interaction.editReply({ content: '❌ Sem permissão.', components: [] });
        const prodId = interaction.values[0];
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.editReply('❌ Produto não encontrado.');

        const { count: totalItens } = await supabase
          .from('itens_estoque')
          .select('*', { count: 'exact', head: true })
          .eq('produto_id', prodId)
          .eq('vendido', false);

        const { data: itens } = await supabase
          .from('itens_estoque')
          .select('*')
          .eq('produto_id', prodId)
          .eq('vendido', false)
          .order('id', { ascending: false })
          .limit(25);

        const embed = new EmbedBuilder()
          .setTitle(`📦 Estoque: ${prod.nome}`)
          .setDescription(`Total no estoque: **${totalItens || 0}** item(ns)${itens?.length > 0 ? `\n\nÚltimos itens (selecione para remover):` : '\n\nNenhum item no estoque.'}`)
          .setColor('#0099FF');

        const components = [];

        if (itens?.length > 0) {
          const selectRemove = new StringSelectMenuBuilder()
            .setCustomId(`select_remove_item_${prodId}`)
            .setPlaceholder('Selecione um item para remover...')
            .addOptions(
              itens.map((item, i) => ({
                label: item.conteudo.length > 80 ? item.conteudo.substring(0, 77) + '...' : item.conteudo,
                value: String(item.id)
              }))
            );
          components.push(new ActionRowBuilder().addComponents(selectRemove));
        }

        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`action_additens_${prodId}`).setLabel('Adicionar Itens').setStyle(ButtonStyle.Success).setEmoji('📦'),
            new ButtonBuilder().setCustomId(`action_delete_product_${prodId}`).setLabel('Excluir Produto').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
          )
        );

        return interaction.editReply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
      }

      if (interaction.customId.startsWith('select_remove_item_')) {
        if (!isStaff) return interaction.editReply({ content: '❌ Sem permissão.', components: [] });
        const prodId = interaction.customId.split('_')[3];
        const itemId = interaction.values[0];
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const { data: item } = await supabase.from('itens_estoque').select('*').match({ id: itemId, vendido: false }).maybeSingle();
        if (!item) return interaction.editReply('❌ Item não encontrado ou já foi vendido.');

        await supabase.from('itens_estoque').delete().match({ id: itemId });
        await refreshChannelPanel(interaction, prodId);

        return interaction.editReply(`✅ Item removido do estoque:\n\`\`\`${item.conteudo}\`\`\``);
      }

      if (interaction.customId.startsWith('select_edit_plan_')) {
        if (!isStaff) return interaction.editReply({ content: '❌ Sem permissão.', components: [] });
        const prodId = interaction.customId.split('_')[3];
        const index = parseInt(interaction.values[0]);
        const { data: prod } = await supabase.from('produtos').select('opcoes').match({ id: prodId }).maybeSingle();
        if (!prod?.opcoes?.[index]) return interaction.editReply('❌ Plano não encontrado.');
        const plano = prod.opcoes[index];
        const modal = new ModalBuilder().setCustomId(`modal_edit_plan_${prodId}_${index}`).setTitle('Editar Plano');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_plan_nome').setLabel('Nome do Plano').setStyle(TextInputStyle.Short).setValue(plano.nome)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_plan_preco').setLabel('Preço').setStyle(TextInputStyle.Short).setValue(String(plano.preco)))
        );
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'select_prod_addestoque') {
        if (!isStaff) return interaction.editReply({ content: '❌ Sem permissão.', components: [] });
        const prodId = interaction.values[0];
        const modal = new ModalBuilder().setCustomId(`modal_add_itens_${prodId}`).setTitle('Adicionar Itens ao Estoque');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('itens_conteudo')
              .setLabel('Itens (um por linha)')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('KEY-ABC-123\nKEY-DEF-456\nhttps://linkdoproduto.com')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('itens_plano')
              .setLabel('Nome do Plano (opcional)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Deixe vazio para qualquer plano')
              .setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }
    }

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // === SAAS ADMIN COMMANDS ===
      if (['saas-add-bot', 'saas-list', 'saas-stop', 'saas-start', 'saas-restart'].includes(commandName)) {
        if (!botManager) return interaction.reply({ content: '❌ Sistema admin não disponível.', flags: [MessageFlags.Ephemeral] });
        if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Apenas o admin pode usar este comando.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (commandName === 'saas-add-bot') {
          const token = interaction.options.getString('token');
          const username = interaction.options.getString('username') || null;
          const planInput = (interaction.options.getString('plan') || 'mensal').toLowerCase();

          const planDurations = { semanal: 7, mensal: 30, trimestral: 90 };
          const days = planDurations[planInput];
          if (!days) return interaction.editReply(`❌ Plano inválido. Use: semanal, mensal ou trimestral.`);

          const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

          const { encrypt } = await import('./crypto.js');
          const encryptedToken = encrypt(token);
          const { data, error } = await supabase.from('clients').insert({
            bot_token: encryptedToken, username, plan: planInput, active: true,
            expires_at, created_at: new Date().toISOString()
          }).select().maybeSingle();
          if (error) return interaction.editReply(`❌ Erro: ${error.message}`);
          try { await botManager.startBot(data.id); } catch (e) {}
          return interaction.editReply(`✅ Bot **${data.id.slice(0,8)}...** criado! Plano: ${planInput}. Expira: ${new Date(expires_at).toLocaleDateString('pt-BR')}`);
        }

        if (commandName === 'saas-list') {
          const { data: clients } = await supabase.from('clients').select('id, username, plan, active, created_at').order('created_at', { ascending: false });
          if (!clients?.length) return interaction.editReply('📭 Nenhum cliente cadastrado.');
          const statuses = botManager.getAllStatuses();
          const lines = clients.map(c => `\`${c.id.slice(0,8)}...\` **${c.username || 'sem nome'}** | ${c.plan} | ${c.active ? '✅' : '❌'} | Bot: ${statuses[c.id] || 'offline'}\nCriado: ${new Date(c.created_at).toLocaleDateString('pt-BR')}`);
          const msg = `📋 **Clientes:**\n\n${lines.join('\n\n')}`;
          return interaction.editReply(msg.slice(0, 1900));
        }

        const clientId = interaction.options.getString('id');
        if (commandName === 'saas-stop') {
          await botManager.stopBot(clientId);
          return interaction.editReply(`🛑 Bot ${clientId.slice(0,8)}... parado.`);
        }
        if (commandName === 'saas-start') {
          try { await botManager.startBot(clientId); return interaction.editReply(`▶️ Bot ${clientId.slice(0,8)}... iniciado.`); }
          catch (e) { return interaction.editReply(`❌ Erro: ${e.message}`); }
        }
        if (commandName === 'saas-restart') {
          try { await botManager.restartBot(clientId); return interaction.editReply(`🔄 Bot ${clientId.slice(0,8)}... reiniciado.`); }
          catch (e) { return interaction.editReply(`❌ Erro: ${e.message}`); }
        }
      }

      if (commandName === 'painel') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const embedPainelConfig = new EmbedBuilder()
          .setTitle(`🛠️ Painel Whitelabel | ${client.user.username}`)
          .setDescription('Gerencie a identidade visual, finanças e os canais de redirecionamento do seu bot.')
          .setColor('#5865F2');

        const rowPainel = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_panel_identity').setLabel('Identidade do Bot').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
          new ButtonBuilder().setCustomId('btn_panel_shop').setLabel('Configurações da Loja').setStyle(ButtonStyle.Success).setEmoji('⚙️'),
          new ButtonBuilder().setCustomId('btn_panel_channels').setLabel('Canais da Loja').setStyle(ButtonStyle.Primary).setEmoji('📁'),
          new ButtonBuilder().setCustomId('btn_panel_products').setLabel('Produtos').setStyle(ButtonStyle.Primary).setEmoji('📦'),
          new ButtonBuilder().setCustomId('trigger_extrato_vendas').setLabel('Extrato de Vendas').setStyle(ButtonStyle.Secondary).setEmoji('📜')
        );
        const rowCupons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_panel_cupons').setLabel('Cupons de Desconto').setStyle(ButtonStyle.Primary).setEmoji('🎟️')
        );
        return await interaction.reply({ embeds: [embedPainelConfig], components: [rowPainel, rowCupons], flags: [MessageFlags.Ephemeral] });
      }

      if (commandName === 'setup-vendas') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const nome = interaction.options.getString('nome');
        const preco = parseFloat(interaction.options.getString('preco').replace(',', '.'));
        const descricao = interaction.options.getString('descricao');
        const imagem = interaction.options.getString('imagem') || null;

        const { data: novoProduto, error } = await supabase.from('produtos').insert([{
          nome: nome, preco: preco, descricao: descricao, imagem_url: imagem, canal_id: interaction.channelId, opcoes: [], guild_id: interaction.guildId, active: true
        }]).select().maybeSingle();

        if (error) return interaction.editReply('❌ Erro ao registrar o produto.');

        const embed = await renderSingleProductEmbed(interaction, novoProduto);
        const cmps = await getSingleProductComponents(novoProduto, false);
        await interaction.channel.send({ embeds: [embed], components: cmps });
        return interaction.editReply({ content: `✅ Painel criado para o produto **${nome}**!` });
      }

      if (commandName === 'setup-ticket') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const { data: cfg } = await supabase.from('configuracoes_tickets').select('*').match({ guild_id: interaction.guildId, channel_id: interaction.channelId }).maybeSingle();

        const embedTicket = new EmbedBuilder()
          .setTitle(cfg?.ticket_title || `Central de Atendimento | ${client.user.username}`)
          .setDescription(cfg?.ticket_desc || `> Após solicitar atendimento, aguarde a resposta de um membro da equipe.\n\n> Os atendimentos são realizados de forma privada.\n\nClique no botão abaixo para abrir um ticket:`)
          .setColor('#2F3136');

        if (cfg?.ticket_banner && cfg.ticket_banner.startsWith('http')) {
          embedTicket.setImage(cfg.ticket_banner);
        }

        const rowTicket = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('open_ticket').setLabel('Abrir Suporte').setStyle(ButtonStyle.Secondary).setEmoji('🎫')
        );

        await interaction.channel.send({ embeds: [embedTicket], components: [rowTicket] });
        return interaction.editReply('✅ Painel de suporte criado!');
      }

      if (commandName === 'dashboard') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply();
        
        const { data: aprovados } = await supabase
          .from('pedidos')
          .select('*')
          .eq('status', 'APROVADO')
          .eq('guild_id', interaction.guildId);
        const total = aprovados.reduce((acc, p) => acc + parseFloat(p.valor || 0), 0);
        
        const embed = new EmbedBuilder().setTitle(`📊 Dashboard Analítico | ${guild.name}`).setColor('#00FFFF').addFields(
          { name: '📈 Vendas', value: `${aprovados.length}`, inline: true },
          { name: '💰 Faturamento', value: `R$ ${total.toFixed(2)}`, inline: true }
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      if (commandName === 'editar-setup-vendas') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const messages = await interaction.channel.messages.fetch({ limit: 50 });
        const painelMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
        if (!painelMsg) return interaction.editReply('❌ Nenhum painel de produto encontrado neste canal.');

        const allComps = painelMsg.components.flatMap(r => r.components);
        const idComp = allComps.find(c => c.customId?.startsWith('buy_main_') || c.customId?.startsWith('select_plan_') || c.customId?.startsWith('edit_prod_'));
        if (!idComp) return interaction.editReply('❌ Painel de produto não reconhecido.');
        const prodId = idComp.customId.split('_')[2];

        const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.editReply('❌ Produto não encontrado na base de dados.');

        const embedMenuEdit = new EmbedBuilder().setTitle(`⚙️ Editando: ${prod.nome}`).setColor('#0099FF');
        const rowEdit = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_editdesc_${prod.id}`).setLabel('Editar Descrição').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_addplan_${prod.id}`).setLabel('Adicionar Plano').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`action_editplan_${prod.id}`).setLabel('Editar Plano').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_editbanner_${prod.id}`).setLabel('Alterar Banner').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId(`action_clearplans_${prod.id}`).setLabel('Limpar Planos').setStyle(ButtonStyle.Danger)
        );
        const rowStock = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_additens_${prod.id}`).setLabel('Adicionar Itens').setStyle(ButtonStyle.Secondary).setEmoji('📦')
        );
        const rowPrice = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_editname_${prod.id}`).setLabel('Editar Nome').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_editprice_${prod.id}`).setLabel('Editar Preço').setStyle(ButtonStyle.Primary).setEmoji('💰'),
          new ButtonBuilder().setCustomId(`action_delete_product_${prod.id}`).setLabel('Excluir Produto').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        );
        return await interaction.editReply({ embeds: [embedMenuEdit], components: [rowEdit, rowStock, rowPrice] });
      }

      if (commandName === 'editar-setup-ticket') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });

        const msgs = await interaction.channel.messages.fetch({ limit: 50 });
        const painelMsg = msgs.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components.some(c => c.customId === 'open_ticket'));
        if (!painelMsg) return interaction.reply({ content: '❌ Nenhum painel de ticket encontrado neste canal.', flags: [MessageFlags.Ephemeral] });

        const { data: config } = await supabase.from('configuracoes_tickets').select('*').match({ guild_id: interaction.guildId, channel_id: interaction.channelId }).maybeSingle();

        const modal = new ModalBuilder().setCustomId('modal_edit_ticket_config').setTitle('Configurar Painel deste Canal');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticket_title_input').setLabel('Título do Painel').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.ticket_title || '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticket_desc_input').setLabel('Descrição do Painel').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(config?.ticket_desc || '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticket_banner_input').setLabel('URL da Imagem/Banner (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.ticket_banner || '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticket_role_input').setLabel('ID do Cargo para menção').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.ticket_role_id || ''))
        );
        return await interaction.showModal(modal);
      }

      if (commandName === 'add-estoque') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const messages = await interaction.channel.messages.fetch({ limit: 50 });
        const painelMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
        if (!painelMsg) return interaction.editReply('❌ Nenhum painel de produto encontrado neste canal.');

        const allComps = painelMsg.components.flatMap(r => r.components);
        const idComp = allComps.find(c => c.customId?.startsWith('buy_main_') || c.customId?.startsWith('select_plan_') || c.customId?.startsWith('edit_prod_'));
        if (!idComp) return interaction.editReply('❌ Painel de produto não reconhecido.');
        const prodId = idComp.customId.split('_')[2];

        const { data: prod } = await supabase.from('produtos').select('*').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.editReply('❌ Produto não encontrado na base de dados.');

        const modal = new ModalBuilder().setCustomId(`modal_add_itens_${prod.id}`).setTitle(`Adicionar Itens - ${prod.nome}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('itens_conteudo')
              .setLabel('Itens (um por linha)')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('KEY-ABC-123\nKEY-DEF-456\nhttps://linkdoproduto.com')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('itens_plano')
              .setLabel('Nome do Plano (opcional)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Deixe vazio para qualquer plano')
              .setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      if (commandName === 'entrar-call') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.voice.channel) return interaction.editReply('❌ Você precisa estar em uma call para usar este comando.');

        const channel = member.voice.channel;
        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            connection.destroy();
            await supabase.from('calls').update({ ativo: false }).match({ guild_id: guild.id });
          }
        });
        connection.on('error', console.error);

        await supabase.from('calls').upsert({
          guild_id: guild.id,
          channel_id: channel.id,
          ativo: true
        });

        return interaction.editReply(`✅ Entrei na call **${channel.name}** e vou ficar 24h online!`);
      }

      if (commandName === 'sair-call') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const { data: call } = await supabase.from('calls').select('*').match({ guild_id: guild.id, ativo: true }).maybeSingle();
        if (call) {
          const connection = getVoiceConnection(guild.id);
          if (connection) try { connection.destroy(); } catch (e) {}
          await supabase.from('calls').update({ ativo: false }).match({ guild_id: guild.id });
        }

        return interaction.editReply('✅ Saí da call!');
      }

    }

    if (interaction.isButton()) {
      const { customId, user } = interaction;

      if (customId.startsWith('apply_coupon_')) {
        const pedidoId = customId.split('_')[2];
        if (pedidoId === 'fallback') return interaction.reply({ content: '❌ Este pedido não pode mais receber cupom.', flags: [MessageFlags.Ephemeral] });
        const { data: pedido } = await supabase.from('pedidos').select('*').match({ id: pedidoId }).maybeSingle();
        if (!pedido) return interaction.reply({ content: '❌ Pedido não encontrado.', flags: [MessageFlags.Ephemeral] });
        if (pedido.status !== 'PENDENTE') return interaction.reply({ content: '❌ Este pedido já foi processado.', flags: [MessageFlags.Ephemeral] });

        const modal = new ModalBuilder().setCustomId(`modal_apply_coupon_${pedidoId}`).setTitle('🎟️ Aplicar Cupom');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('coupon_code')
              .setLabel('Digite o código do cupom')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ex: DESCONTO10')
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('approve_') || customId.startsWith('deny_')) {
        if (!isStaff) {
          return await interaction.reply({ content: '❌ Apenas membros da equipe/Staff podem interagir com os botões de auditoria.', flags: [MessageFlags.Ephemeral] });
        }
      }

      if (customId === 'open_ticket') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const nomeCanal = `🎫-suporte-${user.username.toLowerCase()}`;
        const canalExistente = guild.channels.cache.find(c => c.name === nomeCanal);
        if (canalExistente) return interaction.editReply({ content: `❌ Você já possui um ticket aberto em <#${canalExistente.id}>.` });

        const canalTicket = await guild.channels.create({
          name: nomeCanal,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
          ]
        });

        await interaction.editReply({ content: `✅ Seu ticket foi gerado com sucesso em <#${canalTicket.id}>` });

        const { data: cfg } = await supabase.from('configuracoes_tickets').select('ticket_role_id').match({ guild_id: guild.id, channel_id: interaction.channelId }).maybeSingle();
        const mencaoCargo = cfg?.ticket_role_id ? `<@&${cfg.ticket_role_id}>` : `@here`;

        const embedBoasVindas = new EmbedBuilder()
          .setTitle(`🎫 Central de Atendimento`)
          .setDescription(`Olá ${user}, informe nossa equipe detalhadamente sobre sua dúvida ou problema. Seu atendimento iniciará em breve.`)
          .setColor('#00FFCC');

        const rowFecharTicket = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket').setLabel('Fechar Atendimento').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );

        await canalTicket.send({ content: `${user} | ${mencaoCargo}`, embeds: [embedBoasVindas], components: [rowFecharTicket] });
      }

      if (customId === 'close_ticket') {
        await interaction.deferUpdate();
        await interaction.channel.send('🔒 Atendimento finalizado. Canal sendo excluído em 5 segundos...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      }

      // BOTÃO DE CONFIGURAR DO TICKET (AGORA CARREGA AUTOMATICAMENTE OS DADOS ATUAIS SALVOS)
      if (customId === 'edit_ticket_config') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        
        const { data: config } = await supabase
          .from('configuracoes_tickets')
          .select('*')
          .match({ guild_id: interaction.guildId, channel_id: interaction.channelId })
          .maybeSingle();

        const modal = new ModalBuilder().setCustomId('modal_edit_ticket_config').setTitle('Configurar Painel deste Canal');
        
        const titleInput = new TextInputBuilder()
          .setCustomId('ticket_title_input')
          .setLabel('Título do Painel')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config?.ticket_title || '');

        const descInput = new TextInputBuilder()
          .setCustomId('ticket_desc_input')
          .setLabel('Descrição do Painel')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(config?.ticket_desc || '');

        const bannerInput = new TextInputBuilder()
          .setCustomId('ticket_banner_input')
          .setLabel('URL da Imagem/Banner (opcional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config?.ticket_banner || '');

        const roleInput = new TextInputBuilder()
          .setCustomId('ticket_role_input')
          .setLabel('ID do Cargo para menção')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config?.ticket_role_id || '');
        
        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(bannerInput),
          new ActionRowBuilder().addComponents(roleInput)
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'btn_panel_identity') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const { data: cfg } = await supabase.from('configuracoes').select('bot_name, bot_avatar').match({ guild_id: interaction.guildId }).maybeSingle();
        const modal = new ModalBuilder().setCustomId('modal_identity_submit').setTitle('🎨 Alterar Identidade Visual');
        const nameInput = new TextInputBuilder().setCustomId('modal_bot_name').setLabel('Nome do Bot').setStyle(TextInputStyle.Short).setValue(cfg?.bot_name || client.user.username);
        const avatarValido = cfg?.bot_avatar && /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(cfg.bot_avatar);
        const avatarInput = new TextInputBuilder().setCustomId('modal_bot_avatar').setLabel('Link do Avatar').setStyle(TextInputStyle.Short).setRequired(false).setValue(avatarValido ? cfg.bot_avatar : '');
        modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(avatarInput));
        return await interaction.showModal(modal);
      }

      if (customId === 'btn_panel_shop') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const { data: config } = await supabase.from('configuracoes').select('*').match({ guild_id: interaction.guildId }).maybeSingle();

        const modal = new ModalBuilder().setCustomId('modal_shop_config_submit').setTitle('⚙️ Configurações Operacionais');
        const pixInput = new TextInputBuilder().setCustomId('modal_pix').setLabel('Sua Chave Pix').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.pix_key || '');
        const pixNameInput = new TextInputBuilder().setCustomId('modal_pix_name').setLabel('Nome do Beneficiário Pix').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.pix_name || '');
        const pixCityInput = new TextInputBuilder().setCustomId('modal_pix_city').setLabel('Cidade do Beneficiário Pix').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.pix_city || '');
        const clientRoleInput = new TextInputBuilder().setCustomId('modal_role_client').setLabel('ID Cargo Cliente').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.role_id || '');
        const staffRoleInput = new TextInputBuilder().setCustomId('modal_role_staff').setLabel('ID Cargo Staff (Permissão Bot)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.staff_role_id || '');

        modal.addComponents(
          new ActionRowBuilder().addComponents(pixInput),
          new ActionRowBuilder().addComponents(pixNameInput),
          new ActionRowBuilder().addComponents(pixCityInput),
          new ActionRowBuilder().addComponents(clientRoleInput),
          new ActionRowBuilder().addComponents(staffRoleInput)
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'btn_panel_channels') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const { data: config } = await supabase.from('configuracoes').select('*').match({ guild_id: interaction.guildId }).maybeSingle();

        const modal = new ModalBuilder().setCustomId('modal_shop_channels_submit').setTitle('📁 Canais de Redirecionamento');
        const logsVendasInput = new TextInputBuilder().setCustomId('modal_logs_vendas').setLabel('ID Canal Logs de Vendas (Recibo)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.logs_vendas_id || '');
        const canalLojaInput = new TextInputBuilder().setCustomId('modal_loja_vendas').setLabel('ID Canal de Vendas (Botão Comprar)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.loja_channel_id || '');
        const feedbacksInput = new TextInputBuilder().setCustomId('modal_feedbacks').setLabel('ID Canal Feedbacks (Botão Feedbacks)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config?.feedback_channel_id || '');

        modal.addComponents(
          new ActionRowBuilder().addComponents(logsVendasInput),
          new ActionRowBuilder().addComponents(canalLojaInput),
          new ActionRowBuilder().addComponents(feedbacksInput)
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'btn_panel_cupons') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const embed = new EmbedBuilder()
          .setTitle('🎟️ Gerenciar Cupons de Desconto')
          .setDescription('Crie e gerencie cupons de desconto para seus produtos.')
          .setColor('#5865F2');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_cupom_criar').setLabel('Criar Cupom').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId('btn_cupom_listar').setLabel('Listar Cupons').setStyle(ButtonStyle.Primary).setEmoji('📋')
        );
        return await interaction.reply({ embeds: [embed], components: [row], flags: [MessageFlags.Ephemeral] });
      }

      if (customId === 'btn_cupom_criar') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const modal = new ModalBuilder().setCustomId('modal_cupom_criar').setTitle('🎟️ Criar Cupom de Desconto');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cupom_codigo').setLabel('Código do Cupom').setStyle(TextInputStyle.Short).setPlaceholder('Ex: DESCONTO10').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cupom_tipo').setLabel('Tipo: "percentual" ou "fixo"').setStyle(TextInputStyle.Short).setPlaceholder('percentual').setValue('percentual').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cupom_valor').setLabel('Valor (10 = 10% ou R$10)').setStyle(TextInputStyle.Short).setPlaceholder('10').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cupom_produto').setLabel('Nome exato do produto (ou "qualquer")').setStyle(TextInputStyle.Short).setPlaceholder('qualquer').setValue('qualquer').setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cupom_usos').setLabel('Máximo de usos (deixe vazio = ilimitado)').setStyle(TextInputStyle.Short).setPlaceholder('100').setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'btn_cupom_listar') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { data: cupons } = await supabase.from('cupons').select('*').eq('guild_id', interaction.guildId).order('codigo');
        if (!cupons?.length) return interaction.editReply('❌ Nenhum cupom cadastrado neste servidor.');

        const lines = cupons.map(c => {
          const tipo = c.desconto_tipo === 'percentual' ? `${c.desconto_valor}%` : `R$ ${parseFloat(c.desconto_valor).toFixed(2)}`;
          const usos = c.usos_maximos ? `${c.usos_atuais}/${c.usos_maximos}` : `${c.usos_atuais}/∞`;
          const status = c.ativo ? '✅' : '❌';
          return `${status} **${c.codigo}** — ${tipo} | Usos: ${usos} | Produto: ${c.produto_id || 'qualquer'}`;
        });
        return interaction.editReply(`📋 **Cupons do servidor:**\n\n${lines.join('\n')}`);
      }

      if (customId === 'btn_panel_products') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { data: todos } = await supabase.from('produtos').select('id, nome, canal_id').match({ active: true }).eq('guild_id', interaction.guildId);
        if (!todos?.length) return interaction.editReply('❌ Nenhum produto ativo encontrado neste servidor.');

        const produtosAtivos = [];
        for (const p of todos) {
          const ch = await guild.channels.fetch(p.canal_id).catch(() => null);
          if (ch) {
            produtosAtivos.push(p);
          } else {
            await supabase.from('produtos').update({ active: false }).match({ id: p.id });
          }
        }

        if (!produtosAtivos.length) return interaction.editReply('❌ Nenhum produto com canal ativo encontrado.');

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_panel_stock')
          .setPlaceholder('Selecione um produto para gerenciar o estoque...')
          .addOptions(produtosAtivos.slice(0, 25).map(p => ({
            label: p.nome,
            value: String(p.id)
          })));
        return interaction.editReply({ content: '📦 **Produtos deste servidor:**', components: [new ActionRowBuilder().addComponents(select)] });
      }

      if (customId === 'trigger_extrato_vendas') {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const { data: vendas } = await supabase
          .from('pedidos')
          .select('id, user_id, valor, produto_id, channel_id')
          .eq('status', 'APROVADO')
          .eq('guild_id', interaction.guildId)
          .order('id', { ascending: false })
          .limit(10);

        if (!vendas || vendas.length === 0) return interaction.editReply('📜 Nenhum histórico de vendas encontrado para este servidor.');
        
        const embed = new EmbedBuilder().setTitle(`📜 Últimas Vendas | ${guild.name}`).setColor('#00FF88').setTimestamp();
        
        for (const v of vendas) {
          let nomeProduto = 'Item';
          if (v.produto_id) {
            const { data: pData } = await supabase.from('produtos').select('nome').match({ id: v.produto_id }).maybeSingle();
            if (pData?.nome) nomeProduto = pData.nome;
          }
          embed.addFields({ name: `ID: #${v.id} - ${nomeProduto}`, value: `Valor: R$ ${parseFloat(v.valor || 0).toFixed(2)} | Comprador: <@${v.user_id}>` });
        }
        return await interaction.editReply({ embeds: [embed] });
      }

      if (customId.startsWith('buy_main_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const produtoId = customId.split('_')[2];
        const { data: prod } = await supabase.from('produtos').select('*').match({ id: produtoId }).maybeSingle();
        if (!prod) return interaction.editReply('Produto não encontrado.');

        const { count: stockCount } = await supabase
          .from('itens_estoque')
          .select('*', { count: 'exact', head: true })
          .eq('produto_id', prod.id)
          .eq('vendido', false)
          .is('plano_nome', null);
        if (!stockCount || stockCount === 0) return interaction.editReply('❌ Este produto está sem estoque no momento.');

        const canal = await guild.channels.create({
          name: `🛒-pix-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const { data: insData } = await supabase.from('pedidos').insert([{ 
          user_id: user.id, 
          channel_id: canal.id, 
          produto_id: prod.id, 
          valor: prod.preco, 
          status: 'PENDENTE' 
        }]).select('id').maybeSingle();

        const { data: cfg } = await supabase.from('configuracoes').select('*').match({ guild_id: guild.id }).maybeSingle();

        const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        let pixString, qrCodeUrl, embedDescription, mpPaymentId;

        if (mpToken && insData?.id) {
          try {
            const { createPixPayment } = await import('./mercadopago.js');
            const mpPayment = await createPixPayment({
              amount: parseFloat(prod.preco),
              description: prod.nome,
              externalReference: String(insData.id),
              email: `${user.id}@discord.gg`
            });
            pixString = mpPayment.point_of_interaction?.transaction_data?.qr_code || '';
            qrCodeUrl = mpPayment.point_of_interaction?.transaction_data?.qr_code_base64
              ? `data:image/png;base64,${mpPayment.point_of_interaction.transaction_data.qr_code_base64}`
              : `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixString)}`;
            mpPaymentId = mpPayment.id;
            await supabase.from('pedidos').update({ mp_payment_id: String(mpPayment.id) }).eq('id', insData.id);
          } catch (e) {
            console.error('Erro MP PIX buy_main, fallback:', e.message);
          }
        }

        if (!pixString) {
          pixString = generatePix(prod.preco, user.username, { chave: cfg?.pix_key, nome: cfg?.pix_name, cidade: cfg?.pix_city });
          qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixString)}`;
        }

        embedDescription = mpPaymentId
          ? `Produto: \`${prod.nome}\`\nValor: \`R$ ${parseFloat(prod.preco).toFixed(2)}\`\n\n**PIX Mercado Pago** (confirmação automática)\n\`\`\`${pixString}\`\`\``
          : `Produto: \`${prod.nome}\`\nValor: \`R$ ${parseFloat(prod.preco).toFixed(2)}\`\nChave Pix:\n\`${cfg?.pix_key || process.env.PIX_KEY}\``;

        await interaction.editReply(`🔒 Canal de pagamentos: <#${canal.id}>`);
        const embedPix = new EmbedBuilder()
          .setTitle('📥 Instruções de Pagamento')
          .setColor('#00FFCC')
          .setDescription(embedDescription)
          .setImage(qrCodeUrl);

        const rowControleStaff = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${insData?.id || 'fallback'}`).setLabel('Aprovar Pedido').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`deny_${insData?.id || 'fallback'}`).setLabel('Recusar Pedido').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        const rowCupom = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`apply_coupon_${insData?.id || 'fallback'}`).setLabel('🎟️ Cupom de Desconto').setStyle(ButtonStyle.Primary)
        );

        await canal.send({ content: `${user}`, embeds: [embedPix], components: [rowControleStaff, rowCupom] });
      }

      if (customId.startsWith('edit_prod_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const embedMenuEdit = new EmbedBuilder().setTitle('⚙️ Menu de Edição Rápida').setColor('#0099FF');
        const rowEditOptions = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_editdesc_${prodId}`).setLabel('Editar Descrição').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_addplan_${prodId}`).setLabel('Adicionar Plano').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`action_editplan_${prodId}`).setLabel('Editar Plano').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_editbanner_${prodId}`).setLabel('Alterar Banner').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId(`action_clearplans_${prodId}`).setLabel('Limpar Planos').setStyle(ButtonStyle.Danger)
        );
        const rowStockOptions = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_additens_${prodId}`).setLabel('Adicionar Itens').setStyle(ButtonStyle.Secondary).setEmoji('📦')
        );
        const rowPrice = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`action_editname_${prodId}`).setLabel('Editar Nome').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`action_editprice_${prodId}`).setLabel('Editar Preço').setStyle(ButtonStyle.Primary).setEmoji('💰'),
          new ButtonBuilder().setCustomId(`action_delete_product_${prodId}`).setLabel('Excluir Produto').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        );
        return await interaction.reply({ embeds: [embedMenuEdit], components: [rowEditOptions, rowStockOptions, rowPrice], flags: [MessageFlags.Ephemeral] });
      }

      if (customId.startsWith('action_editdesc_')) {
        const modal = new ModalBuilder().setCustomId(`modal_edit_desc_${customId.split('_')[2]}`).setTitle('Editar Descrição');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_desc').setLabel('Nova Descrição').setStyle(TextInputStyle.Paragraph)));
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('action_addplan_')) {
        const modal = new ModalBuilder().setCustomId(`modal_add_plan_${customId.split('_')[2]}`).setTitle('Adicionar Plano');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('plan_nome').setLabel('Nome do Plano').setStyle(TextInputStyle.Short)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('plan_preco').setLabel('Preço').setStyle(TextInputStyle.Short)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('plan_estoque').setLabel('Estoque').setStyle(TextInputStyle.Short).setValue('10'))
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('action_editplan_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const { data: prod } = await supabase.from('produtos').select('opcoes').match({ id: prodId }).maybeSingle();
        if (!prod?.opcoes?.length) return interaction.reply({ content: '❌ Nenhum plano para editar.', flags: [MessageFlags.Ephemeral] });
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_edit_plan_${prodId}`)
          .setPlaceholder('Selecione o plano que deseja editar...')
          .addOptions(prod.opcoes.map((opt, i) => ({
            label: opt.nome,
            description: `R$ ${parseFloat(opt.preco).toFixed(2)}`,
            value: String(i)
          })));
        return await interaction.reply({ content: 'Escolha um plano para editar:', components: [new ActionRowBuilder().addComponents(selectMenu)], flags: [MessageFlags.Ephemeral] });
      }

      if (customId.startsWith('action_editbanner_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const modal = new ModalBuilder().setCustomId(`modal_edit_banner_${prodId}`).setTitle('Alterar Banner do Produto');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('banner_url')
              .setLabel('URL da nova imagem do banner')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('https://link-da-imagem.com/banner.png')
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('action_setstock_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const { count: currentStock } = await supabase
          .from('itens_estoque')
          .select('*', { count: 'exact', head: true })
          .eq('produto_id', prodId)
          .eq('vendido', false);
        const modal = new ModalBuilder().setCustomId(`modal_set_stock_${prodId}`).setTitle('Definir Estoque');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('stock_qtd')
              .setLabel(`Estoque atual: ${currentStock || 0}. Novo total:`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Digite a quantidade desejada de itens')
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('action_editprice_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const { data: prod } = await supabase.from('produtos').select('preco').match({ id: prodId }).maybeSingle();
        const modal = new ModalBuilder().setCustomId(`modal_edit_price_${prodId}`).setTitle('Editar Preço');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('new_price')
              .setLabel('Novo Preço')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ex: 29.90')
              .setValue(prod?.preco ? String(prod.preco) : '')
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('action_editname_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const { data: prod } = await supabase.from('produtos').select('nome').match({ id: prodId }).maybeSingle();
        const modal = new ModalBuilder().setCustomId(`modal_edit_name_${prodId}`).setTitle('Editar Nome do Produto');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('new_name')
              .setLabel('Novo Nome')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Digite o novo nome')
              .setValue(prod?.nome || '')
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('action_delete_product_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[3];
        const { data: prod } = await supabase.from('produtos').select('nome, canal_id').match({ id: prodId }).maybeSingle();
        if (!prod) return interaction.reply({ content: '❌ Produto não encontrado.', flags: [MessageFlags.Ephemeral] });

        const confirmModal = new ModalBuilder().setCustomId(`modal_delete_confirm_${prodId}`).setTitle('🗑️ Confirmar exclusão');
        confirmModal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('delete_confirm')
              .setLabel('Digite CONFIRMAR para excluir')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('CONFIRMAR')
              .setRequired(true)
          )
        );
        return await interaction.showModal(confirmModal);
      }

      if (customId.startsWith('action_clearplans_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const { error } = await supabase.from('produtos').update({ opcoes: [] }).match({ id: prodId });
        if (error) return interaction.editReply(`❌ Erro: ${error.message}`);
        await refreshChannelPanel(interaction, prodId);
        return await interaction.editReply('🗑️ Planos removidos!');
      }

      if (customId.startsWith('action_additens_')) {
        if (!isStaff) return interaction.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
        const prodId = customId.split('_')[2];
        const modal = new ModalBuilder().setCustomId(`modal_add_itens_${prodId}`).setTitle('Adicionar Itens ao Estoque');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('itens_conteudo')
              .setLabel('Itens (um por linha)')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('KEY-ABC-123\nKEY-DEF-456\nhttps://linkdoproduto.com')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('itens_plano')
              .setLabel('Nome do Plano (opcional)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Deixe vazio para qualquer plano')
              .setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('approve_')) {
        await interaction.deferUpdate();
        const pedidoId = customId.split('_')[1];
        
        let query = supabase.from('pedidos').update({ status: 'APROVADO', aprovado_por: interaction.user.id });
        
        if (pedidoId === 'fallback') {
          query = query.match({ channel_id: interaction.channelId });
        } else {
          query = query.match({ id: pedidoId });
        }

        const { data: pedidoData } = await query.select('*');
        const pedido = pedidoData?.[0];
        if (!pedido) return;

        const { data: config } = await supabase.from('configuracoes').select('*').match({ guild_id: guild.id }).maybeSingle();
        
        if (config?.role_id) {
          try {
            const membro = await guild.members.fetch(pedido.user_id);
            const cargo = await guild.roles.fetch(config.role_id);
            if (membro && cargo) {
              await membro.roles.add(cargo);
              console.log(`Cargo ${cargo.name} (${cargo.id}) atribuído a ${membro.user.tag} em ${guild.name}`);
            }
          } catch (e) {
            console.error(`Erro ao atribuir cargo (role_id=${config.role_id}, user=${pedido.user_id}, guild=${guild.id}):`, e);
          }
        }

        try {
          const qtd = pedido.quantidade || 1;
          let queryItem = supabase
            .from('itens_estoque')
            .select('*')
            .eq('produto_id', pedido.produto_id)
            .eq('vendido', false)
            .limit(qtd);
          if (pedido.plano_nome) {
            queryItem = queryItem.eq('plano_nome', pedido.plano_nome);
          } else {
            queryItem = queryItem.is('plano_nome', null);
          }
          const { data: itens } = await queryItem;

          if (itens && itens.length > 0) {
            const itemIds = itens.map(i => i.id);
            await supabase.from('itens_estoque').update({ vendido: true, pedido_id: pedido.id }).in('id', itemIds);

            const buyer = await client.users.fetch(pedido.user_id).catch(() => null);
            if (buyer) {
              const conteudos = itens.map(i => i.conteudo).join('\n');
              const embedEntrega = new EmbedBuilder()
                .setTitle('✅ Produto(s) Entregue(s)!')
                .setDescription(`**Obrigado pela compra!**\n\nAqui ${itens.length > 1 ? 'estão seus produtos' : 'está o seu produto'}:\n\`\`\`${conteudos}\`\`\``)
                .setColor('#00FF00');
              await buyer.send({ embeds: [embedEntrega] }).catch(() => {});
            }
          }
        } catch (e) {
          console.error('Erro na entrega automática:', e);
        }

        if (pedido.cupom_codigo) {
          const { data: cupAtual } = await supabase.from('cupons').select('usos_atuais').match({ codigo: pedido.cupom_codigo, guild_id: interaction.guildId }).maybeSingle();
          if (cupAtual) {
            await supabase.from('cupons').update({ usos_atuais: cupAtual.usos_atuais + 1 }).match({ codigo: pedido.cupom_codigo, guild_id: interaction.guildId });
          }
        }

        if (pedido.produto_id) {
          try { await refreshChannelPanel(interaction, pedido.produto_id); } catch (e) {}
        }
        
        try {
          const canal = await guild.channels.fetch(pedido.channel_id);
          if (canal) {
            const embedOnboarding = new EmbedBuilder()
              .setTitle('✅ Pagamento Aprovado')
              .setDescription('Seu pagamento foi confirmado.\nAgora envie o token do seu bot para concluir a instalação.')
              .setColor('#00FF00');
            const rowToken = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`insert_token_${pedido.id}`)
                .setLabel('Inserir Token')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔑')
            );
            await canal.send({ embeds: [embedOnboarding], components: [rowToken] });
          }
        } catch (e) {}

        if (config?.logs_vendas_id) {
          try {
            const canalLogs = await guild.channels.fetch(config.logs_vendas_id).catch(() => null);
            if (canalLogs) {
              let clienteUser = null;
              try { clienteUser = await client.users.fetch(pedido.user_id); } catch(e) {}

              let nomeDoProdutoFinal = 'Produto';
              if (pedido.produto_id) {
                const { data: pData = null } = await supabase.from('produtos').select('nome').match({ id: pedido.produto_id }).maybeSingle();
                if (pData?.nome) nomeDoProdutoFinal = pData.nome;
              }
              if (pedido.plano_nome) nomeDoProdutoFinal += ` - ${pedido.plano_nome}`;

              const compradorTag = clienteUser ? clienteUser.username : `ID: ${pedido.user_id}`;

              const embedLogPublico = new EmbedBuilder()
                .setTitle('🛍️ Entrega Realizada!')
                .setDescription(`O usuário **_${compradorTag}_** teve seu pedido entregue.`)
                .setColor('#23a55a')
                .addFields(
                  { name: 'Carrinho', value: `\`1x ${nomeDoProdutoFinal}\``, inline: false },
                  { name: 'Valor pago', value: `\`R$ ${parseFloat(pedido.valor || 0).toFixed(2).replace('.', ',')}\``, inline: false }
                )
                .setFooter({ text: `${guild.name}` })
                .setTimestamp();

              if (clienteUser) {
                embedLogPublico.setThumbnail(clienteUser.displayAvatarURL({ dynamic: true }));
              }

              const rowLinksLog = new ActionRowBuilder();
              const linkLoja = config.loja_channel_id ? `https://discord.com/channels/${guild.id}/${config.loja_channel_id}` : `https://discord.gg/`;
              const linkFeedback = config.feedback_channel_id ? `https://discord.com/channels/${guild.id}/${config.feedback_channel_id}` : `https://discord.gg/`;

              rowLinksLog.addComponents(
                new ButtonBuilder().setLabel('Comprar').setStyle(ButtonStyle.Link).setURL(linkLoja).setEmoji('🛒'),
                new ButtonBuilder().setLabel('Feedbacks').setStyle(ButtonStyle.Link).setURL(linkFeedback).setEmoji('🏆')
              );

              await canalLogs.send({ embeds: [embedLogPublico], components: [rowLinksLog] });
            }
          } catch (err) {
            console.error("⚠️ Erro ao enviar para o canal de logs:", err);
          }
        }
      }

      if (customId.startsWith('deny_')) {
        await interaction.deferUpdate();
        const pedidoId = customId.split('_')[1];
        
        let query = supabase.from('pedidos').update({ status: 'RECUSADO' });
        if (pedidoId === 'fallback') {
          query = query.match({ channel_id: interaction.channelId });
        } else {
          query = query.match({ id: pedidoId });
        }
        
        await query;
        try {
          await interaction.channel.send('❌ Pedido Recusado pela Staff. Este canal será deletado em 5 segundos...');
          setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        } catch(e) {}
      }

      if (customId.startsWith('cancel_channel_')) {
        await interaction.deferUpdate();
        try {
          await interaction.channel.send('⏳ Venda cancelada. Este canal será deletado em 5 segundos...');
          setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        } catch(e) {}
      }

      if (customId.startsWith('insert_token_')) {
        const pedidoId = customId.split('_')[2];
        const { data: pedido } = await supabase.from('pedidos').select('*, produtos(nome)').eq('id', pedidoId).maybeSingle();
        if (!pedido || pedido.status !== 'APROVADO') return interaction.reply({ content: '❌ Pedido não encontrado ou não aprovado.', flags: [MessageFlags.Ephemeral] });

        const modal = new ModalBuilder().setCustomId(`modal_token_${pedidoId}`).setTitle('🔑 Inserir Token do Bot');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('bot_token_input')
              .setLabel('Token do Bot')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('MTIzNDU... (token do seu bot Discord)')
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('add_bot_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const clientIdFromDb = customId.split('_')[2];

        const { data: clientData } = await supabase.from('clients').select('bot_token').eq('id', clientIdFromDb).maybeSingle();
        if (!clientData?.bot_token) return interaction.editReply('❌ Token não encontrado.');

        let rawToken;
        try {
          const { decrypt } = await import('./crypto.js');
          rawToken = decrypt(clientData.bot_token);
        } catch (e) {
          return interaction.editReply('❌ Erro ao descriptografar token.');
        }

        const PUBLIC_URL = process.env.PUBLIC_URL || '';
        const encodedToken = Buffer.from(rawToken.split('.')[0], 'base64').toString().replace(/[^0-9]/g, '');
        const clientIdNum = rawToken.split('.')[0].length > 5 ? Buffer.from(rawToken.split('.')[0], 'base64').toString().replace(/\D/g, '') : '';

        let actualClientId;
        try {
          const rest = new (await import('discord.js')).REST({ version: '10' }).setToken(rawToken);
          const botUser = await rest.get('/users/@me');
          actualClientId = botUser.id;
        } catch {
          actualClientId = clientIdNum || '';
        }

        const permissions = '8';
        const scopes = 'bot%20applications.commands';
        const redirectUri = PUBLIC_URL ? `&redirect_uri=${encodeURIComponent(PUBLIC_URL + '/oauth/callback')}` : '';
        const stateParam = `&state=${clientIdFromDb}`;
        const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${actualClientId}&permissions=${permissions}&scope=${scopes}${redirectUri}${stateParam}`;

        const embed = new EmbedBuilder()
          .setTitle('🤖 Bot Pronto para Instalação')
          .setDescription(`Clique no botão abaixo para adicionar seu bot a um servidor Discord.\n\nApós adicionar, volte a este canal e clique em **"Já adicionei"**.`)
          .setColor('#5865F2');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Adicionar Bot').setStyle(ButtonStyle.Link).setURL(oauthUrl).setEmoji('➕'),
          new ButtonBuilder().setCustomId(`check_bot_${clientIdFromDb}`).setLabel('Já Adicionei').setStyle(ButtonStyle.Success).setEmoji('✅')
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (customId.startsWith('check_bot_')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const clientIdFromDb = customId.split('_')[2];

        let { data: clientData } = await supabase.from('clients').select('server_id, bot_token').eq('id', clientIdFromDb).maybeSingle();
        if (!clientData) return interaction.editReply('❌ Cliente não encontrado.');

        if (clientData.server_id) {
          try { if (botManager) await botManager.startBot(clientIdFromDb); } catch (e) {}
          const embedSucesso = new EmbedBuilder()
            .setTitle('✅ Bot Iniciado com Sucesso!')
            .setDescription(`Seu bot foi detectado no servidor e está sendo iniciado.\n\nCaso não apareça online, aguarde alguns segundos.`)
            .setColor('#00FF00');
          return interaction.editReply({ embeds: [embedSucesso], components: [] });
        }

        await interaction.editReply('🔍 Verificando servidores... tente novamente em alguns segundos.');
        try {
          if (botManager && clientData.bot_token) {
            await botManager.startBot(clientIdFromDb);
            const maxTentativas = 10;
            for (let i = 0; i < maxTentativas; i++) {
              await new Promise(r => setTimeout(r, 2000));
              const inst = botManager.instances.get(clientIdFromDb);
              if (inst?.client?.guilds?.cache?.size > 0) {
                const guild = inst.client.guilds.cache.first();
                await supabase.from('clients').update({ server_id: guild.id, active: true }).eq('id', clientIdFromDb);
                const embedSucesso = new EmbedBuilder()
                  .setTitle('✅ Bot Detectado e Iniciado!')
                  .setDescription(`Seu bot **${inst.client.user.tag}** foi detectado no servidor **${guild.name}** e já está online!`)
                  .setColor('#00FF00');
                return interaction.editReply({ embeds: [embedSucesso], components: [] });
              }
            }
          }
        } catch (e) {
          console.error(`Erro check_bot:`, e.message);
        }
        await interaction.editReply('❌ Não detectei seu bot em nenhum servidor.\n\nCertifique-se de que:\n1. Usou o link "Adicionar Bot" acima\n2. Selecionou um servidor e autorizou\n\nDepois clique em **"Já Adicionei"** novamente.');
      }
    }
  } catch (error) {
    console.error("❌ ERRO INTERNO:", error);
  }
});

  await client.login(token);
  return client;
}