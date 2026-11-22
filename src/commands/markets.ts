/**
 * /markets command
 * Browse open Kalshi markets using the public market-data endpoint.
 */
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { kalshiAPIClient, KalshiMarket } from '../kalshi-api-client.js';

export const marketsCommand = new SlashCommandBuilder()
  .setName('markets')
  .setDescription('Browse open Kalshi prediction markets')
  .addStringOption(option =>
    option.setName('category')
      .setDescription('Filter by category text when available')
      .setRequired(false)
  );

function pricePercent(dollarValue?: string, legacyCents?: number): string {
  if (dollarValue !== undefined && dollarValue !== null && dollarValue !== '') {
    const value = Number(dollarValue);
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'N/A';
  }
  if (legacyCents !== undefined && Number.isFinite(legacyCents)) return `${legacyCents.toFixed(1)}%`;
  return 'N/A';
}

function marketLabel(market: KalshiMarket): string {
  return (market.title || market.yes_sub_title || market.subtitle || market.ticker || 'Untitled market')
    .replace(/\s+/g, ' ').slice(0, 240);
}

export async function executeMarkets(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const category = interaction.options.getString('category')?.trim();
    console.log(`📊 Fetching open Kalshi markets${category ? ` (category: ${category})` : ''}...`);

    const markets = await kalshiAPIClient.getMarkets(category ? { category } : undefined);
    if (!markets.length) {
      await interaction.editReply({
        content: category
          ? `📭 No open markets matched "${category}". Try another category or leave the filter blank.`
          : '📭 Kalshi returned no open markets at this time.',
      });
      return;
    }

    const selected = markets.slice(0, 10);
    const embed = new EmbedBuilder()
      .setColor(0x00AA66)
      .setTitle('📊 Open Kalshi Markets')
      .setDescription(`Showing ${selected.length} of ${markets.length} returned markets. Use the exact market ticker with /bet.`)
      .setFooter({ text: 'Market prices are indicative; confirm the order book before trading.' });

    selected.forEach((market, index) => {
      const yesBid = pricePercent(market.yes_bid_dollars, market.yes_bid);
      const yesAsk = pricePercent(market.yes_ask_dollars, market.yes_ask);
      const noBid = pricePercent(market.no_bid_dollars, market.no_bid);
      const noAsk = pricePercent(market.no_ask_dollars, market.no_ask);
      const last = pricePercent(market.last_price_dollars, market.last_price);

      embed.addFields({
        name: `${index + 1}. ${marketLabel(market)}`,
        value: [
          `Ticker: \`${market.ticker}\``,
          `YES bid/ask: ${yesBid} / ${yesAsk}`,
          `NO bid/ask: ${noBid} / ${noAsk}`,
          `Last: ${last} • Status: ${market.status || 'unknown'}`,
        ].join('\n').slice(0, 1024),
        inline: false,
      });
    });

    await interaction.editReply({ embeds: [embed] });
    console.log(`✅ Displayed ${selected.length} Kalshi markets to ${interaction.user.username}`);
  } catch (error) {
    console.error('Error in /markets command:', error);
    await interaction.editReply({
      content: '❌ Could not retrieve Kalshi markets. Check the bot logs for the API error and verify KALSHI_BASE_URL.',
    });
  }
}
