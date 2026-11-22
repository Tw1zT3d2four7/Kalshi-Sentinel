/**
 * Kalshi public market-data client.
 * Account-specific requests are handled by the signed request helpers.
 */
import 'dotenv/config';
import axios, { AxiosInstance } from 'axios';

export interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  title: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  category?: string;
  status: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  open_interest_fp?: string;
  volume_24h_fp?: string;
  open_interest?: number;
  volume_24h?: number;
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: 'yes' | 'no';
  status: string;
}

export interface KalshiPortfolio {
  balance?: number;
  balance_dollars?: string;
  portfolio_value?: number;
  positions?: any[];
}

function tradeApiBaseUrl(): string {
  const configured = (process.env.KALSHI_BASE_URL || 'https://demo-api.kalshi.co').replace(/\/+$/, '');
  return configured.endsWith('/trade-api/v2') ? configured : `${configured}/trade-api/v2`;
}

export class KalshiAPIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: tradeApiBaseUrl(),
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Public endpoint: return currently open markets. */
  async getMarkets(filters?: { status?: string; category?: string }): Promise<KalshiMarket[]> {
    try {
      const response = await this.client.get('/markets', {
        params: { status: filters?.status || 'open', limit: 100 },
      });
      const markets: KalshiMarket[] = response.data?.markets || [];
      if (!filters?.category) return markets;
      const category = filters.category.trim().toLowerCase();
      return markets.filter(m => (m.category || '').toLowerCase().includes(category));
    } catch (error) {
      console.error('Error fetching Kalshi markets:', error);
      throw error;
    }
  }

  async getMarketDetails(ticker: string): Promise<KalshiMarket | null> {
    try {
      const response = await this.client.get(`/markets/${encodeURIComponent(ticker)}`);
      return response.data?.market || null;
    } catch (error) {
      console.error('Error fetching Kalshi market details:', error);
      throw error;
    }
  }
}

export const kalshiAPIClient = new KalshiAPIClient();
