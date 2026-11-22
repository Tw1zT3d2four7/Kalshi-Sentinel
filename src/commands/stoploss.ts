/**
 * /stoploss command
 * Monitor a user-supplied entry price and attempt an IOC limit exit at the bid.
 */
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { kalshiUserManager } from '../kalshi-user-manager.js';
import { stopLossManager } from '../stoploss-manager.js';

export const stoplossCommand = new SlashCommandBuilder()
  .setName('stoploss')
  .setDescription('Monitor a Kalshi position and attempt a limit exit')
  .addSubcommand(sub => sub.setName('set').setDescription('Create a stop-loss monitor')
    .addStringOption(o => o.setName('ticker').setDescription('Exact market ticker').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('Position side').addChoices({name:'YES',value:'yes'},{name:'NO',value:'no'}).setRequired(true))
    .addNumberOption(o => o.setName('entry_price').setDescription('Your entry price in dollars (for example 0.52)').setMinValue(0.01).setMaxValue(0.99).setRequired(true))
    .addNumberOption(o => o.setName('drop_percentage').setDescription('Trigger after this percentage drop').setMinValue(0.1).setMaxValue(99).setRequired(true)))
  .addSubcommand(sub => sub.setName('list').setDescription('List active stop-loss monitors'))
  .addSubcommand(sub => sub.setName('stop').setDescription('Stop a monitor')
    .addStringOption(o => o.setName('ticker').setDescription('Market ticker').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('YES or NO').addChoices({name:'YES',value:'yes'},{name:'NO',value:'no'}).setRequired(true)));

export async function executeStopLoss(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (subcommand === 'set') {
      const ticker = interaction.options.getString('ticker', true).trim().toUpperCase();
      const side = interaction.options.getString('side', true) as 'yes' | 'no';
      const basePrice = interaction.options.getNumber('entry_price', true);
      const dropPercentage = interaction.options.getNumber('drop_percentage', true);
      const account = await kalshiUserManager.getKalshiUser(userId);
      if (!account?.kalshi_api_key || !account?.kalshi_private_key) {
        await interaction.editReply({ content: '❌ Link your Kalshi account with /link before setting a stop loss.' });
        return;
      }

      await stopLossManager.startStopLoss({
        userId, marketTicker: ticker, side, basePrice, dropPercentage,
        apiKey: account.kalshi_api_key,
        privateKey: account.kalshi_private_key,
      });
      delete (account as any).kalshi_api_key;
      delete (account as any).kalshi_private_key;

      const trigger = basePrice * (1 - dropPercentage / 100);
      const embed = new EmbedBuilder().setColor(0xe6a23c)
        .setTitle('🛑 Stop-Loss Monitor Connected')
        .setDescription(`Monitoring **${ticker}** • ${side.toUpperCase()}`)
        .addFields(
          { name: 'Entry price (user supplied)', value: `$${basePrice.toFixed(4)}`, inline: true },
          { name: 'Drop threshold', value: `-${dropPercentage}%`, inline: true },
          { name: 'Trigger price', value: `$${trigger.toFixed(4)}`, inline: true },
        )
        .setFooter({ text: 'At trigger, the bot checks your matching position and submits an IOC limit sell at the current bid. Partial/no fills are possible.' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'list') {
      const ids = stopLossManager.getActiveStopLosses(userId);
      await interaction.editReply({ content: ids.length ? `Active stop-loss monitors:\n${ids.map(id => `• ${id.slice(userId.length + 1)}`).join('\n')}` : 'No active stop-loss monitors.' });
      return;
    }

    if (subcommand === 'stop') {
      const ticker = interaction.options.getString('ticker', true).trim().toUpperCase();
      const side = interaction.options.getString('side', true);
      const stopped = stopLossManager.stopStopLoss(userId, ticker, side);
      await interaction.editReply({ content: stopped ? `🛑 Stopped monitor for ${ticker} (${side.toUpperCase()}).` : `No active monitor found for ${ticker} (${side.toUpperCase()}).` });
    }
  } catch (error) {
    console.error('Error in /stoploss command:', error);
    await interaction.editReply({ content: `❌ Could not start or manage the stop-loss monitor: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
}
