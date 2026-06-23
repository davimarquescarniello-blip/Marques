import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export const commandData = new SlashCommandBuilder()
  .setName('painel')
  .setDescription('Painel de configuração exclusiva do MQS Bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // APENAS ADMS PODEM VER OU USAR

export async function execute(interaction) {
  // Cria o Modal (Pop-up)
  const modal = new ModalBuilder()
    .setCustomId('config_modal')
    .setTitle('Configurações do MQS Bot');

  // Campo 1: Chave Pix
  const pixInput = new TextInputBuilder()
    .setCustomId('modal_pix')
    .setLabel('Nova Chave Pix')
    .setPlaceholder('E-mail, CPF, Celular ou Chave Aleatória')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  // Campo 2: Imagem do Catálogo
  const imgInput = new TextInputBuilder()
    .setCustomId('modal_img')
    .setLabel('URL da Imagem do Catálogo')
    .setPlaceholder('https://link-da-imagem.com/foto.png')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  // Campo 3: ID do Cargo de Cliente
  const roleInput = new TextInputBuilder()
    .setCustomId('modal_role')
    .setLabel('ID do Cargo do Comprador')
    .setPlaceholder('Copie o ID do cargo do seu servidor')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  // Adiciona os campos nas linhas do modal
  modal.addComponents(
    new ActionRowBuilder().addComponents(pixInput),
    new ActionRowBuilder().addComponents(imgInput),
    new ActionRowBuilder().addComponents(roleInput)
  );

  // Abre a janela para o Administrador
  await interaction.showModal(modal);
}