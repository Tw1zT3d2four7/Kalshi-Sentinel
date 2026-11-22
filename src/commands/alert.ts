/**
 * /alert command
 * Set alerts against the latest Kalshi market price.
 */
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
import { kalshiUserManager } from '../kalshi-user-manager.js';
import { alertManager } from '../alert-manager.js';
import { kalshiAPIClient } from '../kalshi-api-client.js';
dotenv.config();

export const alertCommand = new SlashCommandBuilder()
  .setName('alert')
  .setDescription('Set price alerts for Kalshi markets')
  .addSubcommand(sub => sub.setName('set').setDescription('Set a price alert')
    .addStringOption(o => o.setName('ticker').setDescription('Exact market ticker from /markets').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('YES or NO price to monitor').addChoices({name:'YES',value:'yes'},{name:'NO',value:'no'}).setRequired(true))
    .addNumberOption(o => o.setName('percentage').setDescription('Alert when price rises by this percentage').setMinValue(0.1).setMaxValue(100).setRequired(true)))
  .addSubcommand(sub => sub.setName('list').setDescription('List active price alerts'))
  .addSubcommand(sub => sub.setName('stop').setDescription('Stop an active price alert')
    .addStringOption(o => o.setName('ticker').setDescription('Market ticker').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('YES or NO').addChoices({name:'YES',value:'yes'},{name:'NO',value:'no'}).setRequired(true)));

export async function executeAlert(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;
  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'set') {
      const ticker = interaction.options.getString('ticker', true).trim().toUpperCase();
      const side = interaction.options.getString('side', true) as 'yes' | 'no';
      const percentage = interaction.options.getNumber('percentage', true);
      const account = await kalshiUserManager.getKalshiUser(userId);
      if (!account?.kalshi_api_key || !account?.kalshi_private_key) {
        await interaction.editReply({ content: '❌ Link your Kalshi account with /link before setting alerts.' });
        return;
      }

      const market = await kalshiAPIClient.getMarketDetails(ticker);
      if (!market) {
        await interaction.editReply({ content: `❌ Kalshi market ${ticker} was not found.` });
        return;
      }
      const yesLast = market.last_price_dollars !== undefined
        ? Number(market.last_price_dollars)
        : (market.last_price !== undefined ? market.last_price / 100 : NaN);
      if (!Number.isFinite(yesLast) || yesLast <= 0 || yesLast >= 1) {
        await interaction.editReply({ content: '❌ This market has no usable last-traded price yet, so an alert reference price cannot be set safely.' });
        return;
      }
      const basePrice = side === 'yes' ? yesLast : 1 - yesLast;
      await alertManager.startAlert({
        userId, marketTicker: ticker, side, basePrice,
        percentageThreshold: percentage,
        apiKey: account.kalshi_api_key,
        privateKey: account.kalshi_private_key,
      });
      delete (account as any).kalshi_api_key;
      delete (account as any).kalshi_private_key;

      const embed = new EmbedBuilder().setColor(0x00aa66)
        .setTitle('✅ Kalshi Price Alert Started')
        .setDescription(`Monitoring **${ticker}** for a ${side.toUpperCase()} price increase.`)
        .addFields(
          { name: 'Reference price', value: `$${basePrice.toFixed(4)}`, inline: true },
          { name: 'Trigger threshold', value: `+${percentage}%`, inline: true },
          { name: 'Trigger price', value: `$${(basePrice * (1 + percentage / 100)).toFixed(4)}`, inline: true },
        )
        .setFooter({ text: 'Reference price is the latest Kalshi last-traded price at setup.' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    if (subcommand === 'list') {
      const ids = alertManager.getActiveAlerts(userId);
      await interaction.editReply({ content: ids.length ? `Active alerts:\n${ids.map(id => `• ${id.slice(userId.length + 1)}`).join('\n')}` : 'No active price alerts.' });
      return;
    }
    if (subcommand === 'stop') {
      const ticker = interaction.options.getString('ticker', true).trim().toUpperCase();
      const side = interaction.options.getString('side', true);
      const stopped = alertManager.stopAlert(userId, ticker, side);
      await interaction.editReply({ content: stopped ? `🛑 Stopped alert for ${ticker} (${side.toUpperCase()}).` : `No active alert found for ${ticker} (${side.toUpperCase()}).` });
    }
  } catch (error) {
    console.error('Error in /alert command:', error);
    await interaction.editReply({ content: '❌ Could not complete the alert request. Check the bot logs for details.' });
  }
}
