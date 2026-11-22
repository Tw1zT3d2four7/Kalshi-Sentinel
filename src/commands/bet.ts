/**
 * /bet command
 * Submit a limit order to Kalshi using the linked user's signed credentials.
 */
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import { kalshiUserManager } from '../kalshi-user-manager.js';
import { makeSignedPostRequest } from '../kalshi-request-signer.js';

dotenv.config();
const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://demo-api.kalshi.co';

export const betCommand = new SlashCommandBuilder()
  .setName('bet')
  .setDescription('Place a limit order on a Kalshi market')
  .addStringOption(option => option.setName('ticker').setDescription('Exact Kalshi market ticker from /markets').setRequired(true))
  .addStringOption(option => option.setName('side').setDescription('YES or NO').addChoices({ name: 'YES', value: 'yes' }, { name: 'NO', value: 'no' }).setRequired(true))
  .addStringOption(option => option.setName('action').setDescription('BUY or SELL').addChoices({ name: 'BUY', value: 'buy' }, { name: 'SELL', value: 'sell' }).setRequired(true))
  .addIntegerOption(option => option.setName('count').setDescription('Number of whole contracts').setRequired(true).setMinValue(1))
  .addIntegerOption(option => option.setName('price').setDescription('Limit price in cents (1–99)').setRequired(true).setMinValue(1).setMaxValue(99));

export async function executeBet(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;
  const username = interaction.user.username;

  try {
    const ticker = interaction.options.getString('ticker', true).trim();
    const side = interaction.options.getString('side', true) as 'yes' | 'no';
    const action = interaction.options.getString('action', true) as 'buy' | 'sell';
    const count = interaction.options.getInteger('count', true);
    const price = interaction.options.getInteger('price', true);

    const kalshiUser = await kalshiUserManager.getKalshiUser(userId);
    if (!kalshiUser?.kalshi_api_key || !kalshiUser?.kalshi_private_key) {
      await interaction.editReply({ content: '❌ No Kalshi account is linked. Use /link first.' });
      return;
    }

    // Kalshi's V1 order endpoint accepts a single side-specific price in cents.
    // Do not send both yes_price and no_price; the API rejects conflicting price fields.
    const orderPayload: Record<string, any> = {
      ticker,
      side,
      action,
      count,
      client_order_id: crypto.randomUUID(),
      time_in_force: 'good_till_canceled',
      self_trade_prevention_type: 'taker_at_cross',
      ...(side === 'yes' ? { yes_price: price } : { no_price: price }),
    };

    console.log(`🧾 ${username} submitting ${action} ${count} ${side.toUpperCase()} at ${price}¢ for ${ticker}`);
    const result = await makeSignedPostRequest(
      '/trade-api/v2/portfolio/orders',
      kalshiUser.kalshi_api_key,
      kalshiUser.kalshi_private_key,
      KALSHI_BASE_URL,
      orderPayload,
    );

    delete (kalshiUser as any).kalshi_private_key;
    delete (kalshiUser as any).kalshi_api_key;

    if (!result?.order?.order_id) {
      await interaction.editReply({ content: '❌ Kalshi did not return an order confirmation. Check the bot logs before retrying to avoid duplicate orders.' });
      return;
    }

    const order = result.order;
    const embed = new EmbedBuilder()
      .setColor(0x00AA66)
      .setTitle('✅ Kalshi Order Submitted')
      .setDescription(`Account: **${kalshiUser.kalshi_username}**`)
      .addFields(
        { name: 'Market', value: `\`${ticker}\``, inline: true },
        { name: 'Action', value: action.toUpperCase(), inline: true },
        { name: 'Side', value: side.toUpperCase(), inline: true },
        { name: 'Contracts', value: String(order.initial_count_fp ?? count), inline: true },
        { name: 'Limit price', value: `${price}¢`, inline: true },
        { name: 'Status', value: String(order.status || 'submitted'), inline: true },
        { name: 'Order ID', value: `\`${order.order_id}\``, inline: false },
      )
      .setFooter({ text: 'A submitted order may remain resting and may not be filled immediately.' });

    await interaction.editReply({ embeds: [embed] });
    console.log(`✅ Kalshi order ${order.order_id} submitted for ${username}`);
  } catch (error: any) {
    console.error('Error in /bet command:', error);
    const apiMessage = error.response?.data?.message || error.response?.data?.error || error.message;
    await interaction.editReply({ content: `❌ Order failed: ${String(apiMessage || 'Unknown Kalshi API error').slice(0, 700)}` });
  }
}
