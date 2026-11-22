/**
 * /stoploss command.
 *
 * Automatic exits are intentionally disabled until position-side, entry-price,
 * live order-book pricing, and limit-order execution can be validated end-to-end.
 * The previous implementation used a hard-coded $0.50 entry and attempted an
 * unsupported market order, which could not safely protect a real position.
 */
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { stopLossManager } from '../stoploss-manager.js';

export const stoplossCommand = new SlashCommandBuilder()
  .setName('stoploss')
  .setDescription('Manage automatic stop-loss monitoring')
  .addSubcommand(sub => sub.setName('set').setDescription('Create a stop loss (temporarily unavailable)')
    .addStringOption(o => o.setName('ticker').setDescription('Market ticker').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('YES or NO').addChoices({name:'YES',value:'yes'},{name:'NO',value:'no'}).setRequired(true))
    .addNumberOption(o => o.setName('drop_percentage').setDescription('Exit threshold percentage').setMinValue(0.1).setMaxValue(100).setRequired(true)))
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
      await interaction.editReply({
        content: '⛔ Automatic stop-loss placement is temporarily disabled. The previous version used a placeholder entry price and an unsupported market-order payload. It will be re-enabled only after position sizing, live bid pricing, and limit-order execution are validated.',
      });
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
    await interaction.editReply({ content: '❌ Could not complete the stop-loss request. Check the bot logs for details.' });
  }
}
