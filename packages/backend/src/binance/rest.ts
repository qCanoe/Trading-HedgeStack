/**
 * Binance USDT-M Futures REST client.
 * Signs requests with HMAC-SHA256 as required by Binance API.
 */
import crypto from 'crypto';
import axios, { type AxiosInstance } from 'axios';
import { config } from '../config/env.js';

const BASE_LIVE = 'https://fapi.binance.com';
const BASE_TESTNET = 'https://testnet.binancefuture.com';

export interface PlaceOrderParams {
  symbol: string;
  side: string;
  positionSide: string;
  type: string;
  quantity?: string;
  price?: string;
  stopPrice?: string;
  reduceOnly?: boolean;
  timeInForce?: string;
  workingType?: string;
  newClientOrderId?: string;
  closePosition?: boolean;
}

export interface BinanceOrderResponse {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  status: string;
  type: string;
  side: string;
  price: string;
  origQty: string;
  stopPrice?: string;
  reduceOnly: boolean;
  positionSide: string;
  updateTime: number;
}

export interface BinanceFuturesPosition {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  unrealizedProfit: string;
  markPrice: string;
}

export class BinanceRestClient {
  private http: AxiosInstance;
  private apiKey: string;
  private apiSecret: string;

  constructor() {
    const base = config.binance.testnet ? BASE_TESTNET : BASE_LIVE;
    this.apiKey = config.binance.apiKey;
    this.apiSecret = config.binance.apiSecret;
    this.http = axios.create({
      baseURL: base,
      headers: { 'X-MBX-APIKEY': this.apiKey },
      timeout: 10_000,
    });
  }

  private sign(params: Record<string, string | number | boolean>): string {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])
    ).toString();
    const sig = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
    return `${qs}&signature=${sig}`;
  }

  // ─── Account ─────────────────────────────────────────────────────────

  async getPositions(symbol?: string): Promise<BinanceFuturesPosition[]> {
    const params: Record<string, string | number> = { timestamp: Date.now() };
    if (symbol) params.symbol = symbol;
    const qs = this.sign(params);
    const res = await this.http.get<BinanceFuturesPosition[]>(`/fapi/v2/positionRisk?${qs}`);
    return res.data.filter((p) => parseFloat(p.positionAmt) !== 0 || symbol !== undefined);
  }

  async getOpenOrders(symbol?: string): Promise<BinanceOrderResponse[]> {
    const params: Record<string, string | number> = { timestamp: Date.now() };
    if (symbol) params.symbol = symbol;
    const qs = this.sign(params);
    const res = await this.http.get<BinanceOrderResponse[]>(`/fapi/v1/openOrders?${qs}`);
    return res.data;
  }

  async getMarkPrice(symbol: string): Promise<{ markPrice: string; indexPrice: string; lastFundingRate: string }> {
    const res = await this.http.get(`/fapi/v1/premiumIndex?symbol=${symbol}`);
    return res.data;
  }

  // ─── Orders ───────────────────────────────────────────────────────────

  async placeOrder(params: PlaceOrderParams): Promise<BinanceOrderResponse> {
    const body: Record<string, string | number | boolean> = {
      symbol: params.symbol,
      side: params.side,
      positionSide: params.positionSide,
      type: params.type,
      timestamp: Date.now(),
    };
    if (params.quantity) body.quantity = params.quantity;
    if (params.price) body.price = params.price;
    if (params.stopPrice) body.stopPrice = params.stopPrice;
    if (params.reduceOnly !== undefined) body.reduceOnly = params.reduceOnly;
    if (params.timeInForce) body.timeInForce = params.timeInForce;
    if (params.workingType) body.workingType = params.workingType;
    if (params.newClientOrderId) body.newClientOrderId = params.newClientOrderId;
    if (params.closePosition) body.closePosition = params.closePosition;

    const qs = this.sign(body);
    const res = await this.http.post<BinanceOrderResponse>(`/fapi/v1/order?${qs}`);
    return res.data;
  }

  async cancelOrder(symbol: string, orderId: string): Promise<BinanceOrderResponse> {
    const qs = this.sign({ symbol, orderId, timestamp: Date.now() });
    const res = await this.http.delete<BinanceOrderResponse>(`/fapi/v1/order?${qs}`);
    return res.data;
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const qs = this.sign({ symbol, timestamp: Date.now() });
    await this.http.delete(`/fapi/v1/allOpenOrders?${qs}`);
  }

  // ─── User Data Stream ──────────────────────────────────────────────────

  async createListenKey(): Promise<string> {
    const res = await this.http.post<{ listenKey: string }>('/fapi/v1/listenKey');
    return res.data.listenKey;
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    await this.http.put(`/fapi/v1/listenKey?listenKey=${listenKey}`);
  }
}
