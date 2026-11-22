/**
 * Kalshi stop-loss monitor.
 * Watches the authenticated ticker stream and submits an IOC limit sell at the
 * currently available bid. IOC limits can partially fill or not fill at all.
 */
import WebSocket from 'ws';
import { Client, EmbedBuilder } from 'discord.js';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import { makeSignedGetRequest, makeSignedPostRequest } from './kalshi-request-signer.js';
dotenv.config();

const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://demo-api.kalshi.co';

export interface StopLossOrder {
  userId: string;
  marketTicker: string;
  side: 'yes' | 'no';
  basePrice: number;
  dropPercentage: number;
  apiKey: string;
  privateKey: string;
}

interface TickerMessage {
  market_ticker: string;
  price_dollars?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
}

export class StopLossManager {
  private activeStopLosses = new Map<string, WebSocket>();
  private discordClient: Client | null = null;

  setDiscordClient(client: Client) { this.discordClient = client; }

  async startStopLoss(stopLoss: StopLossOrder): Promise<void> {
    const id = `${stopLoss.userId}-${stopLoss.marketTicker}-${stopLoss.side}`;
    this.activeStopLosses.get(id)?.close();

    const wsUrl = KALSHI_BASE_URL.includes('demo')
      ? 'wss://demo-api.kalshi.co/trade-api/ws/v2'
      : 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';

    const timestamp = Date.now().toString();
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(timestamp + 'GET/trade-api/ws/v2');
    signer.end();
    const signature = signer.sign({
      key: stopLoss.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    const ws = new WebSocket(wsUrl, {
      headers: {
        'KALSHI-ACCESS-KEY': stopLoss.apiKey,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
      },
    });
    this.activeStopLosses.set(id, ws);
    ws.on('error', error => console.error(`Kalshi stop-loss socket error for ${id}:`, error));

    let hasExecuted = false;
    await new Promise<void>((resolve, reject) => {
      let connected = false;
      const timeout = setTimeout(() => {
        if (!connected) {
          ws.close();
          this.activeStopLosses.delete(id);
          reject(new Error('Kalshi WebSocket connection timed out.'));
        }
      }, 15000);

      ws.once('open', () => {
        connected = true;
        clearTimeout(timeout);
        console.log(`✅ Kalshi ticker stream connected for stop loss ${id}`);
        ws.send(JSON.stringify({
          id: 1,
          cmd: 'subscribe',
          params: { channels: ['ticker'], market_ticker: stopLoss.marketTicker },
        }));
        resolve();
      });

      ws.once('error', error => {
        if (!connected) {
          clearTimeout(timeout);
          this.activeStopLosses.delete(id);
          reject(error);
        } else {
          console.error(`Kalshi WebSocket error for stop loss ${id}:`, error);
        }
      });

      ws.on('message', async raw => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type !== 'ticker' || !message.msg) return;
          const data = message.msg as TickerMessage;
          if (data.market_ticker !== stopLoss.marketTicker || !data.price_dollars) return;

          const yesLast = Number(data.price_dollars);
          if (!Number.isFinite(yesLast) || yesLast <= 0 || yesLast >= 1) return;
          const currentPrice = stopLoss.side === 'yes' ? yesLast : 1 - yesLast;
          const triggerPrice = stopLoss.basePrice * (1 - stopLoss.dropPercentage / 100);

          if (currentPrice <= triggerPrice && !hasExecuted) {
            hasExecuted = true;
            console.warn(`🛑 Stop-loss threshold reached for ${id}; attempting IOC limit exit.`);
            await this.executeSellOrder(stopLoss, currentPrice, data);
            ws.close();
            this.activeStopLosses.delete(id);
          }
        } catch (error) {
          console.error(`Error processing stop-loss ticker for ${id}:`, error);
        }
      });

      ws.on('close', () => {
        if (this.activeStopLosses.get(id) === ws) this.activeStopLosses.delete(id);
        console.log(`Kalshi ticker stream closed for stop loss ${id}`);
      });
    });

  }

  private async executeSellOrder(stopLoss: StopLossOrder, currentPrice: number, market: TickerMessage) {
    try {
      const positions = await makeSignedGetRequest(
        '/trade-api/v2/portfolio/positions?limit=100',
        stopLoss.apiKey, stopLoss.privateKey, KALSHI_BASE_URL,
      );
      const position = (positions.market_positions || []).find((p: any) => p.ticker === stopLoss.marketTicker);
      const signedQuantity = Number(position?.position_fp || 0);
      const heldSide = signedQuantity > 0 ? 'yes' : signedQuantity < 0 ? 'no' : null;

      if (!position || heldSide !== stopLoss.side) {
        await this.sendStopLossDM(stopLoss, currentPrice, null, 'No matching open position was found for the selected side. No order was sent.');
        return;
      }

      const quantity = Math.abs(signedQuantity);
      const yesBid = Number(market.yes_bid_dollars);
      const yesAsk = Number(market.yes_ask_dollars);
      const limitPrice = stopLoss.side === 'yes' ? yesBid : 1 - yesAsk;
      if (!Number.isFinite(limitPrice) || limitPrice < 0.01 || limitPrice > 0.99) {
        await this.sendStopLossDM(stopLoss, currentPrice, null, 'A valid current bid was unavailable. No order was sent.');
        return;
      }

      const body: Record<string, any> = {
        ticker: stopLoss.marketTicker,
        side: stopLoss.side,
        action: 'sell',
        count_fp: quantity.toFixed(2),
        time_in_force: 'immediate_or_cancel',
        self_trade_prevention_type: 'taker_at_cross',
        client_order_id: crypto.randomUUID(),
        ...(stopLoss.side === 'yes'
          ? { yes_price_dollars: limitPrice.toFixed(4) }
          : { no_price_dollars: limitPrice.toFixed(4) }),
      };

      const response = await makeSignedPostRequest(
        '/trade-api/v2/portfolio/orders',
        stopLoss.apiKey, stopLoss.privateKey, KALSHI_BASE_URL, body,
      );
      const order = response?.order;
      if (!order?.order_id) {
        await this.sendStopLossDM(stopLoss, currentPrice, null, 'Kalshi did not return an order ID. Verify the account order history before taking further action.');
        return;
      }

      const filled = Number(order.fill_count_fp ?? order.fill_count ?? 0);
      const remaining = Number(order.remaining_count_fp ?? order.remaining_count ?? Math.max(0, quantity - filled));
      const summary = `IOC limit sell submitted at $${limitPrice.toFixed(4)}. Filled: ${filled.toFixed(2)} / ${quantity.toFixed(2)} contracts; remaining: ${remaining.toFixed(2)}. Order: ${order.order_id}. A partial or zero fill is possible.`;
      await this.sendStopLossDM(stopLoss, currentPrice, order, summary);
    } catch (error) {
      console.error('Stop-loss exit attempt failed:', error);
      await this.sendStopLossDM(
        stopLoss, currentPrice, null,
        error instanceof Error ? error.message : 'Unknown Kalshi order error. Check the account order history.',
      );
    }
  }

  private async sendStopLossDM(stopLoss: StopLossOrder, currentPrice: number, order: any, result: string) {
    if (!this.discordClient) return;
    try {
      const user = await this.discordClient.users.fetch(stopLoss.userId);
      const embed = new EmbedBuilder()
        .setColor(order ? 0xe6a23c : 0xff6b6b)
        .setTitle('🛑 Stop-Loss Triggered — Exit Attempt Report')
        .setDescription(`**${stopLoss.marketTicker}** • ${stopLoss.side.toUpperCase()}`)
        .addFields(
          { name: 'Reference price', value: `$${stopLoss.basePrice.toFixed(4)}`, inline: true },
          { name: 'Trigger price', value: `$${(stopLoss.basePrice * (1 - stopLoss.dropPercentage / 100)).toFixed(4)}`, inline: true },
          { name: 'Observed price', value: `$${currentPrice.toFixed(4)}`, inline: true },
          { name: 'Exit result', value: result.slice(0, 1000), inline: false },
        )
        .setFooter({ text: 'IOC orders may partially fill or remain unfilled; verify positions in Kalshi.' })
        .setTimestamp();
      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error('Could not send stop-loss report DM:', error);
    }
  }

  stopStopLoss(userId: string, ticker: string, side: string) {
    const id = `${userId}-${ticker}-${side}`;
    const ws = this.activeStopLosses.get(id);
    if (!ws) return false;
    ws.close();
    this.activeStopLosses.delete(id);
    return true;
  }

  getActiveStopLosses(userId: string) {
    return Array.from(this.activeStopLosses.keys()).filter(key => key.startsWith(`${userId}-`));
  }

  stopAllStopLosses(userId: string) {
    const ids = this.getActiveStopLosses(userId);
    for (const id of ids) {
      this.activeStopLosses.get(id)?.close();
      this.activeStopLosses.delete(id);
    }
    return ids.length;
  }
}

export const stopLossManager = new StopLossManager();
