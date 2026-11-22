/**
 * Kalshi request signing and HTTP helpers.
 * Kalshi signs: timestamp (milliseconds) + HTTP method + request path.
 * Query strings and request bodies are not part of the signature payload.
 */
import crypto from 'crypto';
import axios from 'axios';

export interface SignedHeaders {
  'KALSHI-ACCESS-KEY': string;
  'KALSHI-ACCESS-SIGNATURE': string;
  'KALSHI-ACCESS-TIMESTAMP': string;
  [key: string]: string;
}

export function signKalshiRequest(
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  apiPath: string,
  apiKey: string,
  privateKey: string,
  _body?: Record<string, any> | null
): SignedHeaders {
  const timestampStr = Date.now().toString();
  const pathWithoutQuery = apiPath.split('?')[0];
  const message = timestampStr + method.toUpperCase() + pathWithoutQuery;

  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    sign.end();
    const signature = sign.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });

    return {
      'KALSHI-ACCESS-KEY': apiKey,
      'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
      'KALSHI-ACCESS-TIMESTAMP': timestampStr,
    };
  } catch (error) {
    console.error('Kalshi request signing failed:', error);
    throw new Error(`Failed to sign Kalshi request: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function makeSignedGetRequest(
  apiPath: string, apiKey: string, privateKey: string, baseUrl: string
) {
  const headers = signKalshiRequest('GET', apiPath, apiKey, privateKey);
  try {
    const response = await axios.get(baseUrl.replace(/\/+$/, '') + apiPath, { headers, timeout: 15000 });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`Kalshi GET failed: ${error.response?.status || 'network'} ${error.message}`, error.response?.data || '');
    } else console.error('Kalshi GET failed:', error);
    throw error;
  }
}

export async function makeSignedPostRequest(
  apiPath: string, apiKey: string, privateKey: string, baseUrl: string, body: Record<string, any>
) {
  const headers = signKalshiRequest('POST', apiPath, apiKey, privateKey, body);
  try {
    const response = await axios.post(baseUrl.replace(/\/+$/, '') + apiPath, body, { headers, timeout: 15000 });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`Kalshi POST failed: ${error.response?.status || 'network'} ${error.message}`, error.response?.data || '');
    } else console.error('Kalshi POST failed:', error);
    throw error;
  }
}
