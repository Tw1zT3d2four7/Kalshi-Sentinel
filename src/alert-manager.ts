/**
 * Kalshi WebSocket price-alert manager.
 */
import WebSocket from 'ws';
import { Client, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://demo-api.kalshi.co';

export interface PriceAlert {
  userId: string;
  marketTicker: string;
  side: 'yes' | 'no';
  basePrice: number;
  percentageThreshold: number;
  apiKey: string;
  privateKey: string;
}

interface TickerMessage {
  market_ticker: string;
  price_dollars?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  ts_ms?: number;
}

export class AlertManager {
  private activeAlerts = new Map<string, WebSocket>();
  private discordClient: Client | null = null;

  setDiscordClient(client: Client) { this.discordClient = client; }

  async startAlert(alert: PriceAlert): Promise<void> {
    const alertId = `${alert.userId}-${alert.marketTicker}-${alert.side}`;
    const existing = this.activeAlerts.get(alertId);
    if (existing) existing.close();

    const isDemo = KALSHI_BASE_URL.includes('demo');
    const wsUrl = isDemo
      ? 'wss://demo-api.kalshi.co/trade-api/ws/v2'
      : 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';

    try {
      // Kalshi requires the timestamp in milliseconds for WebSocket authentication.
      const timestamp = Date.now().toString();
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(timestamp + 'GET/trade-api/ws/v2');
      sign.end();
      const signature = sign.sign({
        key: alert.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      }, 'base64');

      const ws = new WebSocket(wsUrl, {
        headers: {
          'KALSHI-ACCESS-KEY': alert.apiKey,
          'KALSHI-ACCESS-SIGNATURE': signature,
          'KALSHI-ACCESS-TIMESTAMP': timestamp,
        },
      });

      ws.on('open', () => {
        console.log(`✅ Kalshi ticker stream connected for ${alertId}`);
        ws.send(JSON.stringify({
          id: 1,
          cmd: 'subscribe',
          params: { channels: ['ticker'], market_ticker: alert.marketTicker },
        }));
      });

      ws.on('message', async raw => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type !== 'ticker' || !message.msg) return;
          const data = message.msg as TickerMessage;
          if (data.market_ticker !== alert.marketTicker || !data.price_dollars) return;

          const yesPrice = Number(data.price_dollars);
          if (!Number.isFinite(yesPrice) || yesPrice <= 0 || yesPrice >= 1) return;
          const currentPrice = alert.side === 'yes' ? yesPrice : 1 - yesPrice;
          const triggerPrice = alert.basePrice * (1 + alert.percentageThreshold / 100);

          if (currentPrice >= triggerPrice) {
            console.log(`🚨 Price alert triggered for ${alertId}: ${currentPrice}`);
            await this.sendAlert(alert, currentPrice, data);
            ws.close();
            this.activeAlerts.delete(alertId);
          }
        } catch (error) {
          console.error('Error processing Kalshi ticker update:', error);
        }
      });

      ws.on('error', error => console.error(`❌ Kalshi WebSocket error for ${alertId}:`, error));
      ws.on('close', () => {
        console.log(`🔌 Kalshi ticker stream closed for ${alertId}`);
        if (this.activeAlerts.get(alertId) === ws) this.activeAlerts.delete(alertId);
      });
      this.activeAlerts.set(alertId, ws);
      await new Promise<void>((resolve, reject) => {
        let connected = false;
        const timeout = setTimeout(() => {
          if (!connected) {
            ws.close();
            if (this.activeAlerts.get(alertId) === ws) this.activeAlerts.delete(alertId);
            reject(new Error('Kalshi WebSocket connection timed out.'));
          }
        }, 15000);
        ws.once('open', () => { connected = true; clearTimeout(timeout); resolve(); });
        ws.once('error', error => {
          if (!connected) {
            clearTimeout(timeout);
            if (this.activeAlerts.get(alertId) === ws) this.activeAlerts.delete(alertId);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Could not start Kalshi price alert:', error);
      throw error;
    }
  }

  private async sendAlert(alert: PriceAlert, currentPrice: number, marketData: TickerMessage) {
    if (!this.discordClient) return;
    try {
      const marketInfo = await this.fetchMarketDetails(alert.marketTicker, alert.apiKey, alert.privateKey);
      const user = await this.discordClient.users.fetch(alert.userId);
      const percentageMove = ((currentPrice - alert.basePrice) / alert.basePrice * 100).toFixed(2);
      const yesPrice = marketData.price_dollars ? Number(marketData.price_dollars) : 0;
      const noPrice = 1 - yesPrice;

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('🚨 Kalshi Price Alert Triggered')
        .setDescription(`**${alert.marketTicker}**\n${marketInfo?.title || 'Market'}`)
        .addFields(
          { name: 'Side watched', value: alert.side.toUpperCase(), inline: true },
          { name: 'Reference price', value: `$${alert.basePrice.toFixed(4)}`, inline: true },
          { name: 'Current price', value: `$${currentPrice.toFixed(4)}`, inline: true },
          { name: 'Movement', value: `+${percentageMove}%`, inline: true },
          { name: 'YES last price', value: `$${yesPrice.toFixed(4)}`, inline: true },
          { name: 'NO implied price', value: `$${noPrice.toFixed(4)}`, inline: true },
          { name: 'Market status', value: String(marketInfo?.status || 'unknown'), inline: true },
        )
        .setFooter({ text: `Alert threshold: +${alert.percentageThreshold}%` })
        .setTimestamp();

      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error('Could not send Kalshi alert DM:', error);
    }
  }

  private async fetchMarketDetails(ticker: string, apiKey: string, privateKey: string) {
    try {
      const path = `/trade-api/v2/markets/${encodeURIComponent(ticker)}`;
      const timestamp = Date.now().toString();
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(timestamp + 'GET' + path);
      sign.end();
      const signature = sign.sign({
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      }, 'base64');
      const response = await axios.get(KALSHI_BASE_URL.replace(/\/+$/, '') + path, {
        headers: {
          'KALSHI-ACCESS-KEY': apiKey,
          'KALSHI-ACCESS-SIGNATURE': signature,
          'KALSHI-ACCESS-TIMESTAMP': timestamp,
        },
        timeout: 15000,
      });
      return response.data?.market || null;
    } catch (error) {
      console.error('Could not fetch Kalshi market details for alert:', error);
      return null;
    }
  }

  stopAlert(userId: string, marketTicker: string, side: string) {
    const id = `${userId}-${marketTicker}-${side}`;
    const ws = this.activeAlerts.get(id);
    if (!ws) return false;
    ws.close();
    this.activeAlerts.delete(id);
    return true;
  }

  getActiveAlerts(userId: string) {
    return Array.from(this.activeAlerts.keys()).filter(key => key.startsWith(`${userId}-`));
  }

  stopAllAlerts(userId: string) {
    const ids = this.getActiveAlerts(userId);
    for (const id of ids) {
      this.activeAlerts.get(id)?.close();
      this.activeAlerts.delete(id);
    }
    return ids.length;
  }
}

export const alertManager = new AlertManager();
