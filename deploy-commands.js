import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from './src/crypto.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

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

async function registerForClient(clientId, token) {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    const clientUser = await rest.get(Routes.user());
    await rest.put(Routes.applicationCommands(clientUser.id), { body: commands });
    console.log(`✅ Comandos registrados para client ${clientId} (${clientUser.username})`);
  } catch (error) {
    console.error(`❌ Erro ao registrar comandos para client ${clientId}:`, error.message);
  }
}

async function main() {
  const targetId = process.argv[2];

  if (targetId && targetId.startsWith('ND')) {
    // Direct token provided as argument
    const rest = new REST({ version: '10' }).setToken(targetId);
    try {
      const clientUser = await rest.get(Routes.user());
      await rest.put(Routes.applicationCommands(clientUser.id), { body: commands });
      console.log(`✅ Comandos registrados para bot ${clientUser.username}`);
    } catch (error) {
      console.error('❌ Erro:', error.message);
    }
    return;
  }

  if (targetId) {
    // Register for specific client ID
    const { data: client } = await supabase.from('clients').select('bot_token').eq('id', targetId).maybeSingle();
    if (!client) {
      console.error('❌ Cliente não encontrado.');
      return;
    }
    const token = decrypt(client.bot_token);
    await registerForClient(targetId, token);
    return;
  }

  // Register for ALL active clients
  const { data: clients } = await supabase.from('clients').select('id, bot_token').eq('active', true);
  if (!clients?.length) {
    console.log('ℹ️ Nenhum cliente ativo encontrado.');
    return;
  }
  console.log(`📋 Registrando comandos para ${clients.length} cliente(s)...`);
  for (const c of clients) {
    try {
      const token = decrypt(c.bot_token);
      await registerForClient(c.id, token);
    } catch (e) {
      console.error(`❌ Falha ao processar client ${c.id}:`, e.message);
    }
  }
  console.log('✅ Registro em massa concluído!');
}

main().catch(console.error);
